// Аудитор SQL — замок 3 изоляции (ROLE-01, SEC-04, PRIV-07, ADR-0006, ARCHITECTURE §6.2). Чистая функция над
// итоговым текстом запроса: Drizzle вызывает её из Logger.logQuery ДО отправки (drizzle-orm 1.0.0-rc.5,
// pg-core/async/session.js), исключение отменяет запрос. Проверяется текст, который ушёл бы в базу, — построитель,
// JOIN, подзапрос, CTE или сырой sql.
//
// Как читает (ADR-0019). Текст разбирает парсер PostgreSQL 18 (libpg-query, WASM): дерево то же, что строит база,
// поэтому строки, комментарии, имена в кавычках, U&"…", регистр, <база>.public.t и ключевые слова решает грамматика
// Postgres, а не догадка. Текст, который парсер не принял, — отказ UNPARSEABLE_SQL: база его тоже не выполнит,
// а пропустить непрочитанное аудитор не может. Текст ошибки парсера в сообщение не попадает (OBS-04).
//
// Что проверяет. Одна команда из белого списка по тегу узла: SelectStmt (с WITH, VALUES, TABLE, UNION),
// InsertStmt, UpdateStmt, DeleteStmt, TransactionStmt и SET TRANSACTION; DO, COPY, CALL, SET, DDL и прочее —
// нарушение; SELECT … INTO — нигде в дереве (Postgres берёт INTO у левой ветки UNION: это CREATE TABLE AS);
// MERGE — нигде в дереве (WITH … MERGE и MERGE в CTE вставляют без INSERT); нет функций,
// исполняющих SQL из строки (query_to_xml, ts_stat, dblink…) или меняющих настройки соединения (set_config);
// пользовательская таблица — только в схеме public. Каждое обращение к пользовательской таблице (RangeVar в
// FROM, JOIN, подзапросе, CTE, цели UPDATE/DELETE) сужено условием своей области (см. narrowLevel): конъюнктом
// WHERE или ON соединения (ON внешнего соединения — только для nullable-стороны), OR — если сужает каждая ветка;
// предикат — «household_id = $n» этого обращения (по алиасу; без квалификатора — когда пользовательская таблица в
// области одна), значение $n сверяется с домохозяйством scope на каждом вызове. SET (в том числе кортежный и в
// ON CONFLICT DO UPDATE) не меняет household_id; INSERT в пользовательскую таблицу — только отдельной командой
// без WITH и только VALUES со своим household_id в каждой строке (INSERT … SELECT, VALUES … UNION, INSERT внутри
// CTE — нарушение: их строки не проверить); цель ON CONFLICT включает household_id; crossTenant — один SELECT без
// записи, блокировок и UNION, возвращающий только id, household_id, user_id.
//
// Чего не видит: SQL внутри представлений и функций базы (их запрещает проверка схемы, schema-check.ts);
// побочные каналы — выражение рядом с фильтром (`note::int = 1`, деление на ноль) база может вычислить и на
// чужой строке раньше фильтра, и ошибка покажет значение; это закрывают построитель ScopedDb (s.own, s.update,
// s.delete ставят фильтр сами) и ревью сырого SQL. Ошибается аудитор в сторону «громко»: не засчитывает
// сужение, которое не может доказать по дереву (HAVING, `household_id IN ($1)`, USING, LATERAL-подзапрос с
// предикатом внешней таблицы, имя соединения с алиасом), и безвредный подзапрос без own тоже останавливает
// (правило «у каждой таблицы свой own»).
//
// Сверка с Postgres — audit-differential.int.test.ts: одни и те же запросы в разных записях база выполняет в
// транзакции с откатом; каждый текст, принятый базой, принимает и парсер; таблица, которую база тронула
// (pg_stat_xact_user_tables), видна аудитору; запрос, через который утекли данные другого домохозяйства, —
// остановлен.
import { loadModule, parseSync, scanSync } from "libpg-query";

// ADR-0019: модуль WASM загружается один раз при импорте, дальше разбор синхронный — Logger Drizzle синхронен.
await loadModule();

export type AuditMode =
  /** ScopedDb: каждое обращение к пользовательской таблице ограничено household_id из scope. */
  | { readonly kind: "scoped"; readonly householdId: string }
  /** SystemDb: пользовательские таблицы запрещены целиком. */
  | { readonly kind: "system" }
  /** crossTenant (defineSweep): один SELECT, возвращающий только id, household_id, user_id. */
  | { readonly kind: "cross-tenant" };

export type ViolationReason =
  | "MISSING_HOUSEHOLD_FILTER"
  | "OWNER_CHANGE"
  | "INSERT_WITHOUT_HOUSEHOLD"
  | "INSERT_FOREIGN_HOUSEHOLD"
  | "INSERT_SELECT"
  | "INSERT_NOT_STANDALONE"
  | "UPSERT_TARGET"
  | "SYSTEM_TOUCHES_USER_DATA"
  | "CROSS_TENANT_NOT_SELECT"
  | "CROSS_TENANT_COLUMNS"
  | "STATEMENT_NOT_ALLOWED"
  | "MULTIPLE_STATEMENTS"
  | "HIDDEN_SQL"
  | "UNPARSEABLE_SQL";

/**
 * Запрос нарушает изоляцию — баг запроса, а не помеха: не ловить и не глушить (CONSTRAINTS «Пол»). Код
 * ISOLATION_VIOLATION не входит в каталог ошибок @kosht/contract: наружу (T-005) он уходит как INTERNAL.
 * В тексте — таблица, что добавить и SQL без значений: параметров нет, строковые литералы скрыты (OBS-04).
 */
export class IsolationViolation extends Error {
  readonly code = "ISOLATION_VIOLATION";
  readonly reason: ViolationReason;
  readonly table: string | undefined;

  constructor(reason: ViolationReason, table: string | undefined, hint: string, sqlText: string) {
    super(`ISOLATION_VIOLATION [${reason}] ${hint}\n  SQL: ${maskSql(sqlText)}`);
    this.name = "IsolationViolation";
    this.reason = reason;
    this.table = table;
  }
}

/**
 * Проверить запрос. `owned` — имена пользовательских таблиц (реестр tables.ts): незагруженная таблица не
 * проверяется, поэтому старт приложения импортирует все схемы.
 */
export function auditQuery(
  sqlText: string,
  params: readonly unknown[],
  mode: AuditMode,
  owned: ReadonlySet<string>,
): void {
  const analysis = analyse(sqlText, owned);
  const fault =
    analysis.statement ??
    (mode.kind === "cross-tenant"
      ? analysis.crossTenant
      : mode.kind === "system"
        ? analysis.system
        : scopedFault(analysis, params, mode.householdId));
  if (fault !== undefined)
    throw new IsolationViolation(fault.reason, fault.table, fault.hint, sqlText);
}

// ── Разбор ───────────────────────────────────────────────────────────────────────────────────────────

/** Нарушение без текста запроса: текст добавляет IsolationViolation (маскированным). */
interface Fault {
  readonly reason: ViolationReason;
  readonly table?: string | undefined;
  readonly hint: string;
}

/**
 * Условие «household_id обращения = домохозяйство scope», собранное из дерева; значения `$n` подставляются на
 * каждом вызове. `param` — предикат `household_id = $n`; `any` — конъюнкция (сужает, если сужает любой конъюнкт);
 * `all` — дизъюнкция (сужает, если сужает каждая ветка). Пустой `any` — не сужает.
 */
type Narrowing =
  | { readonly param: number }
  | { readonly any: readonly Narrowing[] }
  | { readonly all: readonly Narrowing[] };

const NEVER: Narrowing = { any: [] };

interface Ref {
  readonly table: string;
  readonly alias: string;
  readonly narrowing: Narrowing;
}

interface Insert {
  readonly table: string;
  /** Номер колонки household_id в списке колонок; -1 — колонки нет. */
  readonly householdColumn: number;
  /** Номера параметров household_id по строкам VALUES (null — не параметр); null — не VALUES. */
  readonly rows: readonly (number | null)[] | null;
  /** Цель ON CONFLICT: список колонок; "constraint" — ON CONSTRAINT; undefined — ON CONFLICT нет или без цели. */
  readonly conflictTarget: readonly string[] | "constraint" | undefined;
}

/** Решение по тексту, не зависящее от параметров: на горячем пути остаётся сравнить значения $n. */
interface Analysis {
  /** Нарушение для всех режимов: не разобран, команда не из списка, MERGE, «;», спрятанный SQL, чужая схема. */
  readonly statement: Fault | undefined;
  /** Режим system: обращение к пользовательской таблице. */
  readonly system: Fault | undefined;
  /** Режим cross-tenant. */
  readonly crossTenant: Fault | undefined;
  /** Режим scoped: INSERT внутри WITH или CTE. */
  readonly nestedInsert: Fault | undefined;
  readonly insert: Insert | undefined;
  /** Таблица, у которой SET меняет household_id. */
  readonly ownerChange: string | undefined;
  /** Обращения к пользовательским таблицам (кроме цели INSERT) и чем каждое сужено. */
  readonly refs: readonly Ref[];
}

/** Разбор зависит только от текста: Drizzle выдаёт один и тот же текст, на горячем пути — сравнение параметров. */
const cache = new WeakMap<ReadonlySet<string>, Map<string, Analysis>>();
const CACHE_LIMIT = 2000;

function analyse(sqlText: string, owned: ReadonlySet<string>): Analysis {
  let byText = cache.get(owned);
  if (byText === undefined) {
    byText = new Map();
    cache.set(owned, byText);
  }
  const hit = byText.get(sqlText);
  if (hit !== undefined) return hit;
  const analysis = analyseUncached(sqlText, owned);
  if (byText.size >= CACHE_LIMIT) byText.clear();
  byText.set(sqlText, analysis);
  return analysis;
}

/** Узел дерева libpg-query: `{ Тег: тело }` или вложенная структура без тега (`relation`, `withClause`…). */
type Tree = Readonly<Record<string, unknown>>;

const UNPARSEABLE: Fault = {
  reason: "UNPARSEABLE_SQL",
  hint:
    "парсер PostgreSQL 18 не разобрал запрос — аудитор не пропускает то, что не прочитал (база его тоже " +
    "отвергнет); пишите запрос построителем или sql`…`",
};

function analyseUncached(sqlText: string, owned: ReadonlySet<string>): Analysis {
  let statements: readonly Tree[];
  try {
    statements = (parseSync(sqlText).stmts ?? []).map((raw) => (raw.stmt ?? {}) as Tree);
  } catch {
    // Любой отказ парсера (синтаксис, NUL, сбой WASM) — нарушение UNPARSEABLE_SQL, а не исключение парсера:
    // его текст содержит фрагмент запроса, а наружу уходит только маскированный SQL (OBS-04).
    return rejected(UNPARSEABLE);
  }
  const statement = statementFault(statements, owned);
  if (statement !== undefined) return rejected(statement);
  const [top = {}] = statements;
  const insertBody = top["InsertStmt"] as Tree | undefined;
  const topInsert =
    insertBody !== undefined && insertBody["withClause"] === undefined ? insertBody : undefined;
  const topTarget = topInsert?.["relation"];
  const insert =
    topInsert !== undefined && owned.has(relname(topInsert["relation"]))
      ? parseInsert(topInsert)
      : undefined;
  const refs: Ref[] = [];
  const mentions: string[] = [];
  const narrowed = new Map<Tree, Narrowing>();
  let nestedInsert: string | undefined;
  let ownerChange: string | undefined;
  walk(statements, (field, node) => {
    // FOR UPDATE OF t ссылается на уже названное обращение, а не добавляет новое.
    if (field === "lockedRels") return true;
    if (isRangeVar(node)) {
      const table = relname(node);
      if (!owned.has(table)) return true;
      mentions.push(table);
      // Обращение, которое не попало ни в одну область (FROM, JOIN, цель UPDATE/DELETE), не сужено ничем.
      if (node !== topTarget)
        refs.push({ ...entryOf(node), narrowing: narrowed.get(node) ?? NEVER });
      return true;
    }
    if (isQueryLevel(field, node)) narrowLevel(node, owned, narrowed);
    if (field === "InsertStmt" && node !== topInsert && owned.has(relname(node["relation"]))) {
      nestedInsert ??= relname(node["relation"]);
    }
    const assignments =
      field === "UpdateStmt"
        ? node["targetList"]
        : field === "InsertStmt"
          ? (node["onConflictClause"] as Tree | undefined)?.["targetList"]
          : undefined;
    if (setsHousehold(assignments)) ownerChange ??= relname(node["relation"]);
    return false;
  });
  return {
    statement: undefined,
    system:
      mentions.length > 0
        ? {
            reason: "SYSTEM_TOUCHES_USER_DATA",
            table: mentions[0],
            hint:
              `системный доступ (SystemDb) не читает и не пишет пользовательские таблицы: ` +
              `${[...new Set(mentions)].join(", ")} — данные домохозяйства только через s: ScopedDb`,
          }
        : undefined,
    crossTenant: crossTenantFault(top),
    nestedInsert:
      nestedInsert === undefined
        ? undefined
        : {
            reason: "INSERT_NOT_STANDALONE",
            table: nestedInsert,
            hint:
              `вставка в ${nestedInsert} внутри WITH или CTE: household_id её строк не проверить — вставка ` +
              `только отдельной командой s.insert(${nestedInsert}).values(…)`,
          },
    insert,
    ownerChange,
    refs,
  };
}

function rejected(fault: Fault): Analysis {
  return {
    statement: fault,
    system: undefined,
    crossTenant: undefined,
    nestedInsert: undefined,
    insert: undefined,
    ownerChange: undefined,
    refs: [],
  };
}

/**
 * Обход дерева в глубину: visit(поле, объект) для каждого объекта, где поле — имя, под которым он лежит (для
 * узла `{ Тег: тело }` тело приходит с полем «Тег»); true — внутрь не спускаться.
 */
function walk(value: unknown, visit: (field: string, node: Tree) => boolean, field = ""): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, field);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const node = value as Tree;
  if (visit(field, node)) return;
  for (const key of Object.keys(node)) walk(node[key], visit, key);
}

/** RangeVar — единственный узел с relname: и с тегом (FROM, JOIN), и без (цель INSERT/UPDATE/DELETE). */
function isRangeVar(node: Tree): boolean {
  return typeof node["relname"] === "string";
}

function relname(value: unknown): string {
  const name = (value as Tree | undefined)?.["relname"];
  return typeof name === "string" ? name : "";
}

/** Последнее имя в списке `[{ String: { sval } }]` (функция, оператор, колонка). */
function names(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((item: Tree) => {
    const sval = (item["String"] as Tree | undefined)?.["sval"];
    return typeof sval === "string" ? sval : item["A_Star"] === undefined ? "?" : "*";
  });
}

/** Тег узла `{ Тег: тело }` и его тело. */
function tagOf(node: unknown): [string, Tree] | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const [tag] = Object.keys(node);
  return tag === undefined ? undefined : [tag, (node as Tree)[tag] as Tree];
}

/** Номер параметра `$n` или `$n::тип`; undefined — не параметр. */
function paramNumber(node: unknown): number | undefined {
  const [tag, body] = tagOf(node) ?? ["", {}];
  if (tag === "TypeCast") return paramNumber(body["arg"]);
  return tag === "ParamRef" && typeof body["number"] === "number" ? body["number"] : undefined;
}

// ── Область запроса и булев анализ ──────────────────────────────────────────────────────────────────

/** Обращение в FROM области: по какому имени его называют колонки (алиас или имя таблицы). */
interface Entry {
  readonly table: string;
  readonly alias: string;
  /** Есть ли алиас: без него колонку можно назвать и `public.t.col`. */
  readonly aliased: boolean;
}

function entryOf(rangeVar: Tree): Entry {
  const table = relname(rangeVar);
  const alias = (rangeVar["alias"] as Tree | undefined)?.["aliasname"];
  return typeof alias === "string"
    ? { table, alias, aliased: true }
    : { table, alias: table, aliased: false };
}

/** Тело SelectStmt (с тегом или без — ветви UNION larg/rarg), UpdateStmt или DeleteStmt: своя область имён. */
function isQueryLevel(field: string, node: Tree): boolean {
  if (field === "SelectStmt" || field === "UpdateStmt" || field === "DeleteStmt") return true;
  const op = node["op"];
  return (
    (field === "larg" || field === "rarg") && typeof op === "string" && op.startsWith("SETOP_")
  );
}

/** Обращение области и условия, которые его сужают (WHERE и ON соединений, где это законно). */
interface LevelEntry {
  readonly rangeVar: Tree;
  readonly entry: Entry;
  readonly sources: unknown[];
}

/**
 * Сузить обращения одной области (ROLE-01). Засчитываются конъюнкты WHERE (UPDATE и DELETE — тоже) и ON
 * соединений: ON внутреннего соединения сужает обе стороны, LEFT — только правую (nullable), RIGHT — только левую,
 * FULL — ни одну (строки обеих сторон приходят и без совпадения). Подзапросы, CTE и LATERAL — свои области:
 * предикат внутри них внешнее обращение не сужает.
 */
function narrowLevel(
  level: Tree,
  owned: ReadonlySet<string>,
  narrowed: Map<Tree, Narrowing>,
): void {
  const entries: LevelEntry[] = [];
  const add = (rangeVar: unknown): void => {
    if (typeof rangeVar === "object" && rangeVar !== null && isRangeVar(rangeVar as Tree)) {
      entries.push({ rangeVar: rangeVar as Tree, entry: entryOf(rangeVar as Tree), sources: [] });
    }
  };
  /** Обращения элемента FROM; ON соединения запоминается у тех, кого он сужает. */
  const fromItem = (item: unknown): LevelEntry[] => {
    const [tag, body] = tagOf(item) ?? ["", {}];
    if (tag === "RangeVar") {
      add(body);
      return entries.slice(-1);
    }
    // TABLESAMPLE: алиас — у самой таблицы внутри.
    if (tag === "RangeTableSample") return fromItem(body["relation"]);
    if (tag !== "JoinExpr") return [];
    const left = fromItem(body["larg"]);
    const right = fromItem(body["rarg"]);
    const joinType = body["jointype"];
    const narrowedSides =
      joinType === "JOIN_INNER"
        ? [...left, ...right]
        : joinType === "JOIN_LEFT"
          ? right
          : joinType === "JOIN_RIGHT"
            ? left
            : [];
    for (const side of narrowedSides) side.sources.push(body["quals"]);
    return [...left, ...right];
  };
  add(level["relation"]);
  for (const list of [level["fromClause"], level["usingClause"]]) {
    if (Array.isArray(list)) for (const item of list) fromItem(item);
  }
  const ownedCount = entries.filter((e) => owned.has(e.entry.table)).length;
  for (const { rangeVar, entry, sources } of entries) {
    if (!owned.has(entry.table)) continue;
    const scope = { entry, single: ownedCount === 1 };
    narrowed.set(rangeVar, {
      any: [level["whereClause"], ...sources].map((expr) => narrowingOf(expr, scope)),
    });
  }
}

/**
 * Сужает ли условие обращение: AND — если сужает любой конъюнкт, OR — если каждая ветка; NOT, CASE, подзапрос,
 * IS DISTINCT FROM и прочее — нет. Предикат — `household_id = $n` (или `$n = household_id`) этого обращения.
 */
function narrowingOf(expr: unknown, scope: { entry: Entry; single: boolean }): Narrowing {
  const [tag, body] = tagOf(expr) ?? ["", {}];
  if (tag === "BoolExpr") {
    const args = Array.isArray(body["args"])
      ? body["args"].map((arg) => narrowingOf(arg, scope))
      : [];
    if (body["boolop"] === "AND_EXPR") return { any: args };
    if (body["boolop"] === "OR_EXPR" && args.length > 0) return { all: args };
    return NEVER;
  }
  if (tag !== "A_Expr" || body["kind"] !== "AEXPR_OP") return NEVER;
  const operator = names(body["name"]);
  const plainEquals =
    operator.length === 1 ? operator[0] === "=" : operator.join(".") === "pg_catalog.=";
  if (!plainEquals) return NEVER;
  for (const [column, value] of [
    [body["lexpr"], body["rexpr"]],
    [body["rexpr"], body["lexpr"]],
  ]) {
    const param = paramNumber(value);
    if (param !== undefined && isHouseholdOf(column, scope)) return { param };
  }
  return NEVER;
}

/**
 * Колонка household_id этого обращения: `алиас.household_id`; `[база.]public.t.household_id` у обращения без
 * алиаса; без квалификатора — только когда пользовательская таблица в области одна (у каждой есть household_id,
 * иначе Postgres назовёт ссылку неоднозначной). Квалификатор, которого в области нет, — внешняя таблица.
 */
function isHouseholdOf(column: unknown, scope: { entry: Entry; single: boolean }): boolean {
  const [tag, body] = tagOf(column) ?? ["", {}];
  if (tag !== "ColumnRef") return false;
  const fields = names(body["fields"]);
  if (fields.pop() !== "household_id") return false;
  const { entry } = scope;
  if (fields.length === 0) return scope.single;
  if (fields.length === 1) return fields[0] === entry.alias;
  return !entry.aliased && fields.at(-1) === entry.table && fields.at(-2) === "public";
}

function holds(narrowing: Narrowing, params: readonly unknown[], householdId: string): boolean {
  if ("param" in narrowing) return params[narrowing.param - 1] === householdId;
  if ("any" in narrowing) return narrowing.any.some((n) => holds(n, params, householdId));
  return narrowing.all.every((n) => holds(n, params, householdId));
}

/** Присваивание household_id в списке SET (UPDATE, ON CONFLICT DO UPDATE), в том числе кортежное. */
function setsHousehold(targetList: unknown): boolean {
  if (!Array.isArray(targetList)) return false;
  return targetList.some(
    (item: Tree) => (item["ResTarget"] as Tree | undefined)?.["name"] === "household_id",
  );
}

// ── Белый список и спрятанный SQL (все режимы) ────────────────────────────────────────────────────────

/** Теги разрешённых команд (Drizzle: запросы, транзакции, SAVEPOINT; SET TRANSACTION — отдельно). */
const ALLOWED_STATEMENTS = new Set(["SelectStmt", "InsertStmt", "UpdateStmt", "DeleteStmt"]);

/** Транзакции и SAVEPOINT; PREPARE TRANSACTION и COMMIT/ROLLBACK PREPARED (двухфазные) — нет. */
const ALLOWED_TRANSACTION = new Set(
  ["BEGIN", "START", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE", "ROLLBACK_TO"].map(
    (kind) => `TRANS_STMT_${kind}`,
  ),
);

/**
 * Функции, исполняющие SQL или читающие таблицу по имени из строки (аудитор строки не разбирает), и set_config —
 * настройка (search_path), которая осталась бы на соединении пула для следующих запросов.
 */
const HIDDEN_SQL_FUNCTION =
  /^(?:(?:query|table|cursor|schema|database)_to_xml(?:schema|_and_xmlschema)?|ts_stat|ts_rewrite|dblink\w*|set_config)$/;

function notAllowed(command: string): Fault {
  return {
    reason: "STATEMENT_NOT_ALLOWED",
    hint:
      `команда «${command}» недоступна через ScopedDb, SystemDb и crossTenant: только select, insert, update, ` +
      "delete, with, values и транзакции; DDL и обслуживание — миграции (platform/db/migrate.ts)",
  };
}

function statementFault(
  statements: readonly Tree[],
  owned: ReadonlySet<string>,
): Fault | undefined {
  const [tag = "", body = {}] = tagOf(statements[0]) ?? [];
  const allowed =
    ALLOWED_STATEMENTS.has(tag) ||
    (tag === "TransactionStmt" && ALLOWED_TRANSACTION.has(String(body["kind"]))) ||
    (tag === "VariableSetStmt" &&
      body["kind"] === "VAR_SET_MULTI" &&
      body["name"] === "TRANSACTION");
  if (!allowed) return notAllowed(tag || "пусто");
  let fault: Fault | undefined;
  walk(statements, (field, node) => {
    if (fault !== undefined) return true;
    // SELECT … INTO — это CREATE TABLE AS. Postgres (transformOptionalSelectInto) берёт INTO у самого левого
    // SELECT набора UNION/INTERSECT/EXCEPT, а не у верхнего узла: искать по всему дереву.
    if (node["intoClause"] !== undefined) fault = notAllowed("SELECT … INTO");
    else if (field === "MergeStmt") {
      // MERGE пишет без INSERT (WHEN NOT MATCHED THEN INSERT) и разрешён в WITH и в CTE — его строки не разобрать.
      fault = {
        reason: "STATEMENT_NOT_ALLOWED",
        hint:
          "MERGE недоступен через ScopedDb, SystemDb и crossTenant, в том числе после WITH и внутри CTE: " +
          "вставка — s.insert(…).values(…), правка — s.update(…), удаление — s.delete(…)",
      };
    }
    return false;
  });
  if (fault !== undefined) return fault;
  if (statements.length > 1) {
    return {
      reason: "MULTIPLE_STATEMENTS",
      hint: "в одном запросе несколько команд через «;» — отправляйте каждую отдельным запросом",
    };
  }
  walk(statements, (field, node) => {
    if (fault !== undefined) return true;
    if (field === "FuncCall") {
      const name = names(node["funcname"]).at(-1) ?? "";
      if (HIDDEN_SQL_FUNCTION.test(name)) {
        fault = {
          reason: "HIDDEN_SQL",
          hint:
            `${name}: SQL или имя таблицы внутри строки аудитор не проверяет — пишите запрос построителем ` +
            "или sql`…` с ${s.own(таблица)}",
        };
      }
    }
    // Пользовательские таблицы живут только в public (schema-check.ts); одноимённая таблица другой схемы —
    // не та таблица, которую проверяет аудитор.
    if (isRangeVar(node) && owned.has(relname(node))) {
      const schema = node["schemaname"];
      if (typeof schema === "string" && schema !== "public") {
        fault = {
          reason: "STATEMENT_NOT_ALLOWED",
          table: relname(node),
          hint:
            `${relname(node)} в схеме «${schema}»: пользовательские таблицы — только в public, ` +
            "пишите имя без схемы",
        };
      }
    }
    return false;
  });
  return fault;
}

// ── Режимы ───────────────────────────────────────────────────────────────────────────────────────────

function parseInsert(stmt: Tree): Insert {
  const table = relname(stmt["relation"]);
  const columns = Array.isArray(stmt["cols"])
    ? stmt["cols"].map((col: Tree) => (col["ResTarget"] as Tree | undefined)?.["name"])
    : [];
  const householdColumn = columns.indexOf("household_id");
  const [tag, select] = tagOf(stmt["selectStmt"]) ?? ["", {}];
  const lists = select["valuesLists"];
  // Только VALUES: `VALUES (…) UNION ALL SELECT …` вставляет и строки SELECT — их household_id не проверить.
  const rows =
    tag === "SelectStmt" && Array.isArray(lists) && select["op"] === "SETOP_NONE"
      ? lists.map((list: Tree) => {
          const items = (list["List"] as Tree | undefined)?.["items"];
          return Array.isArray(items) ? (paramNumber(items[householdColumn]) ?? null) : null;
        })
      : null;
  const infer = (stmt["onConflictClause"] as Tree | undefined)?.["infer"] as Tree | undefined;
  let conflictTarget: Insert["conflictTarget"];
  if (infer?.["conname"] !== undefined) conflictTarget = "constraint";
  else if (Array.isArray(infer?.["indexElems"])) {
    conflictTarget = infer["indexElems"].map((elem: Tree) => {
      const name = (elem["IndexElem"] as Tree | undefined)?.["name"];
      return typeof name === "string" ? name : "";
    });
  }
  return { table, householdColumn, rows, conflictTarget };
}

function scopedFault(
  analysis: Analysis,
  params: readonly unknown[],
  householdId: string,
): Fault | undefined {
  if (analysis.nestedInsert !== undefined) return analysis.nestedInsert;
  const insertFault =
    analysis.insert === undefined ? undefined : auditInsert(analysis.insert, params, householdId);
  if (insertFault !== undefined) return insertFault;
  if (analysis.ownerChange !== undefined) {
    return {
      reason: "OWNER_CHANGE",
      table: analysis.ownerChange,
      hint:
        `${analysis.ownerChange}: household_id строки не меняется запросом — обновляйте через ` +
        "s.update(таблица, where).set(…) без householdId",
    };
  }
  const open = analysis.refs.find((ref) => !holds(ref.narrowing, params, householdId));
  return open === undefined ? undefined : missingFilter(open.table, open.alias);
}

function missingFilter(table: string, alias: string): Fault {
  const named = alias === table ? table : `${table} (${alias})`;
  return {
    reason: "MISSING_HOUSEHOLD_FILTER",
    table,
    hint:
      `обращение к ${named} без «household_id = домохозяйство scope» — добавьте s.own(…) этой таблицы ` +
      `в where/on обращения: у каждой таблицы запроса (JOIN, подзапрос, CTE) свой s.own (ADR-0006)`,
  };
}

function auditInsert(
  insert: Insert,
  params: readonly unknown[],
  householdId: string,
): Fault | undefined {
  const { table } = insert;
  if (insert.rows === null) {
    return {
      reason: "INSERT_SELECT",
      table,
      hint: `INSERT … SELECT в ${table} запрещён: household_id каждой строки не проверить — используйте s.insert(${table}).values(…)`,
    };
  }
  if (insert.householdColumn < 0) {
    return {
      reason: "INSERT_WITHOUT_HOUSEHOLD",
      table,
      hint: `вставка в ${table} без household_id — используйте s.insert(…).values(…): он ставит household_id сам`,
    };
  }
  if (insert.rows.some((param) => param === null || params[param - 1] !== householdId)) {
    return {
      reason: "INSERT_FOREIGN_HOUSEHOLD",
      table,
      hint:
        `вставка в ${table}: household_id строки не равен домохозяйству scope — используйте ` +
        "s.insert(…).values(…) без householdId",
    };
  }
  const target = insert.conflictTarget;
  if (target === "constraint" || (target !== undefined && !target.includes("household_id"))) {
    return {
      reason: "UPSERT_TARGET",
      table,
      hint: `ON CONFLICT в ${table}: цель конфликта должна включать household_id — (household_id, id)`,
    };
  }
  return undefined;
}

const OWNER_COLUMNS = new Set(["id", "household_id", "user_id"]);

/** crossTenant: один SELECT без записи, блокировок и UNION; в списке — только id, household_id, user_id. */
function crossTenantFault(top: Tree): Fault | undefined {
  const select = top["SelectStmt"] as Tree | undefined;
  let writes = select === undefined || select["withClause"] !== undefined;
  walk(top, (field, node) => {
    // op есть и у других узлов (GREATEST, CURRENT_DATE): UNION/INTERSECT/EXCEPT — только SETOP_*.
    const op = node["op"];
    const setOperation = typeof op === "string" && op.startsWith("SETOP_") && op !== "SETOP_NONE";
    const write = ["InsertStmt", "UpdateStmt", "DeleteStmt", "MergeStmt"].includes(field);
    if (setOperation || write || field === "lockingClause") writes = true;
    return writes;
  });
  if (writes) {
    return {
      reason: "CROSS_TENANT_NOT_SELECT",
      hint:
        "crossTenant только находит владельцев одним SELECT без записи и блокировок — работа делается задачей " +
        "под scope владельца (defineSweep, ARCHITECTURE §6.6)",
    };
  }
  const targets = Array.isArray(select?.["targetList"]) ? select["targetList"] : [];
  for (const item of targets as Tree[]) {
    const target = (item["ResTarget"] ?? {}) as Tree;
    const [tag, body] = tagOf(target["val"]) ?? ["", {}];
    const fields = tag === "ColumnRef" ? names(body["fields"]) : [];
    const plain =
      target["name"] === undefined &&
      fields.length >= 1 &&
      fields.length <= 2 &&
      OWNER_COLUMNS.has(fields.at(-1) ?? "");
    if (!plain) {
      const requested = fields.length > 0 ? fields.join(".") : `выражение ${tag}`;
      return {
        reason: "CROSS_TENANT_COLUMNS",
        hint:
          `crossTenant возвращает только id, household_id, user_id, а запрошено «${requested.slice(0, 60)}» — ` +
          "остальное читает задача под scope владельца (ARCHITECTURE §6.6)",
      };
    }
  }
  return undefined;
}

// ── Текст для сообщения ──────────────────────────────────────────────────────────────────────────────

/** Строковые константы: '…', E'…', B'…', X'…', N'…', U&'…' и $tag$…$tag$ (лексер Postgres, scanSync). */
const STRING_TOKEN = /^(?:[EeBbXxNn]|[Uu]&)?'|^\$(?!\d)/;

/**
 * Текст для сообщения (OBS-04): токены лексера Postgres без комментариев, строки заменены на '…', не длиннее
 * 300 символов. Текст, который лексер не разобрал (незакрытая строка), в сообщение не попадает вовсе.
 */
function maskSql(sqlText: string): string {
  let tokens: readonly { start: number; end: number; text: string; tokenName: string }[];
  try {
    tokens = scanSync(sqlText).tokens;
  } catch {
    // Без токенов не отличить строку от кода: показать нечего, кроме длины.
    return `(лексер не разобрал текст; ${sqlText.length} символов)`;
  }
  let masked = "";
  let end = -1;
  for (const token of tokens) {
    if (token.tokenName === "SQL_COMMENT" || token.tokenName === "C_COMMENT") continue;
    const text = STRING_TOKEN.test(token.text) ? "'…'" : token.text;
    masked += (end >= 0 && token.start > end ? " " : "") + text;
    end = token.end;
  }
  return masked.length > 300 ? `${masked.slice(0, 300)}…` : masked;
}
