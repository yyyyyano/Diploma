// Аудитор SQL — замок 3 изоляции (ROLE-01, SEC-04, PRIV-07, ADR-0006, ARCHITECTURE §6.2). Чистая функция над
// итоговым текстом запроса: Drizzle вызывает её из Logger.logQuery ДО отправки (drizzle-orm 1.0.0-rc.5,
// pg-core/async/session.js), исключение отменяет запрос. Поэтому неважно, как запрос написан — построителем,
// JOIN, подзапросом, CTE или сырым sql: проверяется то, что ушло бы в базу.
// Это проверка текста, а не доказательство: `… OR true`, предикат в списке select, представления и SQL-функции
// она не видит — их закрывают проверка схемы (schema-check.ts) и ревью. Ошибается она в сторону «громко»:
// безвредный подзапрос без own тоже останавливается (правило «у каждой таблицы свой own»).

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
  | "UPSERT_TARGET"
  | "SYSTEM_TOUCHES_USER_DATA"
  | "CROSS_TENANT_NOT_SELECT"
  | "CROSS_TENANT_COLUMNS";

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
  if (mode.kind === "cross-tenant") {
    auditCrossTenant(sqlText);
    return;
  }
  const parsed = parse(sqlText, owned);
  if (mode.kind === "system") {
    if (parsed.mentions.length > 0) {
      const tables = [...new Set(parsed.mentions)].join(", ");
      throw new IsolationViolation(
        "SYSTEM_TOUCHES_USER_DATA",
        parsed.mentions[0],
        `системный доступ (SystemDb) не читает и не пишет пользовательские таблицы: ${tables} — ` +
          "данные домохозяйства только через s: ScopedDb",
        sqlText,
      );
    }
    return;
  }
  auditScoped(parsed, params, mode.householdId, sqlText);
}

// ── Разбор ───────────────────────────────────────────────────────────────────────────────────────────

interface Ref {
  readonly table: string;
  readonly alias: string;
}

interface Predicate {
  /** Алиас или имя таблицы перед `.household_id`; null — без квалификатора. */
  readonly qualifier: string | null;
  /** Номер параметра `$n`. */
  readonly param: number;
}

interface Insert {
  readonly table: string;
  /** Номер колонки household_id в списке колонок; -1 — колонки нет. */
  readonly householdColumn: number;
  /** Строки VALUES (выражения по колонкам); null — INSERT … SELECT или DEFAULT VALUES. */
  readonly rows: readonly (readonly string[])[] | null;
  /** Цель ON CONFLICT: список колонок; "constraint" — ON CONSTRAINT; undefined — ON CONFLICT нет или без цели. */
  readonly conflictTarget: readonly string[] | "constraint" | undefined;
}

interface Parsed {
  /** Обращения к пользовательским таблицам (кроме цели INSERT). */
  readonly refs: readonly Ref[];
  /** Предикаты `[алиас.]household_id = $n`. */
  readonly predicates: readonly Predicate[];
  /** Все упоминания пользовательских таблиц, включая цель INSERT. */
  readonly mentions: readonly string[];
  readonly insert: Insert | undefined;
  /** Таблица, у которой SET меняет household_id. */
  readonly ownerChange: string | undefined;
}

/** Слова, которые после имени таблицы — не алиас. */
const NOT_ALIAS = new Set(
  (
    "where inner left right full cross join on set using returning group order limit offset values select as " +
    "union except intersect for window having natural lateral from default overriding do and or fetch only"
  ).split(" "),
);

const PREDICATE = /(?:(?:"(\w+)"|\b(\w+))\s*\.\s*)?(?<![\w"])"?household_id"?\s*=\s*\$(\d+)\b/g;
const PREDICATE_REVERSED =
  /\$(\d+)\s*=\s*(?:(?:"(\w+)"|\b(\w+))\s*\.\s*)?"?household_id"?(?![\w"])/g;

/** Разбор зависит только от текста: Drizzle выдаёт один и тот же текст, на горячем пути — сравнение параметров. */
const cache = new WeakMap<ReadonlySet<string>, Map<string, Parsed>>();
const CACHE_LIMIT = 2000;

function parse(sqlText: string, owned: ReadonlySet<string>): Parsed {
  let byText = cache.get(owned);
  if (byText === undefined) {
    byText = new Map();
    cache.set(owned, byText);
  }
  const hit = byText.get(sqlText);
  if (hit !== undefined) return hit;
  const parsed = parseUncached(sqlText, owned);
  if (byText.size >= CACHE_LIMIT) byText.clear();
  byText.set(sqlText, parsed);
  return parsed;
}

function parseUncached(sqlText: string, owned: ReadonlySet<string>): Parsed {
  const text = stripLiterals(sqlText).toLowerCase();
  const insert = parseInsert(text, owned);
  const mentions: string[] = [];
  const refs: Ref[] = [];
  let skipInsertTarget = insert !== undefined;
  if (owned.size > 0) {
    for (const match of text.matchAll(ownedPattern(owned))) {
      const table = match[1] ?? match[2] ?? "";
      mentions.push(table);
      if (skipInsertTarget) {
        skipInsertTarget = false;
        continue;
      }
      const alias = match[3] ?? match[4];
      refs.push({ table, alias: alias === undefined || NOT_ALIAS.has(alias) ? table : alias });
    }
  }
  const predicates: Predicate[] = [];
  for (const m of text.matchAll(PREDICATE)) {
    predicates.push({ qualifier: m[1] ?? m[2] ?? null, param: Number(m[3]) });
  }
  for (const m of text.matchAll(PREDICATE_REVERSED)) {
    predicates.push({ qualifier: m[2] ?? m[3] ?? null, param: Number(m[1]) });
  }
  // Присваивание household_id в SET (UPDATE, ON CONFLICT DO UPDATE) запрещено целиком — поэтому такое
  // «household_id = $n» и не засчитывается как фильтр.
  const ownerChange = setClauses(text).some(([from, to]) =>
    /(?<![\w"])"?household_id"?\s*=/.test(text.slice(from, to)),
  )
    ? (insert?.table ?? refs[0]?.table)
    : undefined;
  return { refs, predicates, mentions, insert, ownerChange };
}

const patterns = new WeakMap<ReadonlySet<string>, RegExp>();

/** Имя пользовательской таблицы в кавычках или без, не квалификатор колонки (`t.col`), с необязательным алиасом. */
function ownedPattern(owned: ReadonlySet<string>): RegExp {
  let pattern = patterns.get(owned);
  if (pattern === undefined) {
    const names = [...owned]
      .toSorted((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|");
    pattern = new RegExp(
      `(?<![\\w.$"])(?:"(${names})"|\\b(${names})\\b)(?!\\s*\\.)(?:\\s+(?:as\\s+)?(?:"(\\w+)"|(\\w+)))?`,
      "g",
    );
    patterns.set(owned, pattern);
  }
  return pattern;
}

/** Комментарии и строки (в том числе E'…' и $$…$$) — не код; `public.` перед именем таблицы снимается. */
function stripLiterals(sqlText: string): string {
  return sqlText
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, "''")
    .replace(/[eE]'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/(?<![\w."])"?public"?\s*\.\s*/gi, "");
}

/** Текст для сообщения: без комментариев, строки заменены на '…', не длиннее 300 символов. */
function maskSql(sqlText: string): string {
  const masked = sqlText
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, "'…'")
    .replace(/[eE]?'(?:[^'\\]|\\.|'')*'/g, "'…'")
    .replace(/\s+/g, " ")
    .trim();
  return masked.length > 300 ? `${masked.slice(0, 300)}…` : masked;
}

/** INSERT в пользовательскую таблицу: колонки, строки VALUES и цель ON CONFLICT. */
function parseInsert(text: string, owned: ReadonlySet<string>): Insert | undefined {
  const head = /^\s*insert\s+into\s+"?(\w+)"?(?!\s*\.)\s*/.exec(text);
  const table = head?.[1];
  if (head === null || table === undefined || !owned.has(table)) return undefined;
  let at = head[0].length;
  let columns: string[] = [];
  if (text[at] === "(") {
    const end = closingParen(text, at);
    columns = splitTopLevel(text.slice(at + 1, end)).map((c) => c.replace(/"/g, "").trim());
    at = end + 1;
  }
  const rest = text.slice(at);
  let rows: string[][] | null = null;
  const values = /^\s*values\s*/.exec(rest);
  if (values !== null) {
    rows = [];
    let i = at + values[0].length;
    while (text[i] === "(") {
      const end = closingParen(text, i);
      rows.push(splitTopLevel(text.slice(i + 1, end)).map((v) => v.trim()));
      const next = /^\s*,\s*/.exec(text.slice(end + 1));
      if (next === null) break;
      i = end + 1 + next[0].length;
    }
  }
  const conflict = /\bon\s+conflict\b\s*(on\s+constraint\b|\(([^)]*)\))?/.exec(rest);
  let conflictTarget: Insert["conflictTarget"];
  if (conflict?.[1]?.startsWith("on")) conflictTarget = "constraint";
  else if (conflict?.[2] !== undefined)
    conflictTarget = conflict[2].split(",").map((c) => c.replace(/"/g, "").trim());
  return { table, householdColumn: columns.indexOf("household_id"), rows, conflictTarget };
}

/** Диапазоны списков присваиваний `SET …` (UPDATE и ON CONFLICT DO UPDATE). */
function setClauses(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const m of text.matchAll(/(?<!["\w])set(?!["\w])/g)) {
    const from = m.index + m[0].length;
    ranges.push([from, scanToClauseEnd(text, from, /\s(?:from|where|returning)(?![\w"])/y)]);
  }
  return ranges;
}

/** Конец предложения: ключевое слово на той же глубине скобок, закрывающая скобка уровнем выше или конец. */
function scanToClauseEnd(text: string, from: number, stop: RegExp): number {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      if (depth === 0) return i;
      depth -= 1;
    } else if (ch === ";" && depth === 0) return i;
    else if (depth === 0) {
      stop.lastIndex = i;
      if (stop.test(text)) return i;
    }
  }
  return text.length;
}

function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/** Разделить по запятым верхнего уровня (скобки функций и подзапросов не режутся). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// ── Режимы ───────────────────────────────────────────────────────────────────────────────────────────

function auditScoped(
  parsed: Parsed,
  params: readonly unknown[],
  householdId: string,
  sqlText: string,
): void {
  const { insert } = parsed;
  if (insert !== undefined) auditInsert(insert, params, householdId, sqlText);
  if (parsed.ownerChange !== undefined) {
    throw new IsolationViolation(
      "OWNER_CHANGE",
      parsed.ownerChange,
      `${parsed.ownerChange}: household_id строки не меняется запросом — обновляйте через ` +
        "s.update(таблица, where).set(…) без householdId",
      sqlText,
    );
  }
  // Каждое обращение «съедает» свой предикат: по алиасу, иначе — предикат без квалификатора.
  const byQualifier = new Map<string, number>();
  let unqualified = 0;
  for (const { qualifier, param } of parsed.predicates) {
    if (params[param - 1] !== householdId) continue;
    if (qualifier === null) unqualified += 1;
    else byQualifier.set(qualifier, (byQualifier.get(qualifier) ?? 0) + 1);
  }
  for (const { table, alias } of parsed.refs) {
    const left = byQualifier.get(alias) ?? 0;
    if (left > 0) {
      byQualifier.set(alias, left - 1);
      continue;
    }
    if (unqualified > 0) {
      unqualified -= 1;
      continue;
    }
    const named = alias === table ? table : `${table} (${alias})`;
    throw new IsolationViolation(
      "MISSING_HOUSEHOLD_FILTER",
      table,
      `обращение к ${named} без «household_id = домохозяйство scope» — добавьте s.own(…) этой таблицы ` +
        `в where/on обращения: у каждой таблицы запроса (JOIN, подзапрос, CTE) свой s.own (ADR-0006)`,
      sqlText,
    );
  }
}

function auditInsert(
  insert: Insert,
  params: readonly unknown[],
  householdId: string,
  sqlText: string,
): void {
  const { table } = insert;
  if (insert.rows === null) {
    throw new IsolationViolation(
      "INSERT_SELECT",
      table,
      `INSERT … SELECT в ${table} запрещён: household_id каждой строки не проверить — используйте s.insert(${table}).values(…)`,
      sqlText,
    );
  }
  if (insert.householdColumn < 0) {
    throw new IsolationViolation(
      "INSERT_WITHOUT_HOUSEHOLD",
      table,
      `вставка в ${table} без household_id — используйте s.insert(…).values(…): он ставит household_id сам`,
      sqlText,
    );
  }
  for (const row of insert.rows) {
    const param = /^\$(\d+)$/.exec(row[insert.householdColumn] ?? "")?.[1];
    if (param === undefined || params[Number(param) - 1] !== householdId) {
      throw new IsolationViolation(
        "INSERT_FOREIGN_HOUSEHOLD",
        table,
        `вставка в ${table}: household_id строки не равен домохозяйству scope — используйте s.insert(…).values(…) ` +
          "без householdId",
        sqlText,
      );
    }
  }
  const target = insert.conflictTarget;
  if (target === "constraint" || (target !== undefined && !target.includes("household_id"))) {
    throw new IsolationViolation(
      "UPSERT_TARGET",
      table,
      `ON CONFLICT в ${table}: цель конфликта должна включать household_id — (household_id, id)`,
      sqlText,
    );
  }
}

const WRITE_OR_LOCK =
  /(?<![\w"])(?:insert|update|delete|merge|truncate|copy|alter|drop|create|grant|revoke|call|lock|share)(?![\w"])/;
const OWNER_COLUMN = /^(?:"?\w+"?\s*\.\s*)?"?(?:id|household_id|user_id)"?$/;

function auditCrossTenant(sqlText: string): void {
  const text = stripLiterals(sqlText).toLowerCase().trim();
  if (!/^select(?![\w"])/.test(text) || WRITE_OR_LOCK.test(text) || text.includes(";")) {
    throw new IsolationViolation(
      "CROSS_TENANT_NOT_SELECT",
      undefined,
      "crossTenant только находит владельцев одним SELECT без записи и блокировок — работа делается задачей " +
        "под scope владельца (defineSweep, ARCHITECTURE §6.6)",
      sqlText,
    );
  }
  const start = /^select\s+(?:distinct\s+)?/.exec(text)?.[0].length ?? 0;
  const end = scanToClauseEnd(text, start, /\sfrom(?![\w"])/y);
  const extra = splitTopLevel(text.slice(start, end))
    .map((item) => item.trim())
    .find((item) => !OWNER_COLUMN.test(item));
  if (extra !== undefined) {
    throw new IsolationViolation(
      "CROSS_TENANT_COLUMNS",
      undefined,
      `crossTenant возвращает только id, household_id, user_id, а запрошено «${extra.slice(0, 60)}» — ` +
        "остальное читает задача под scope владельца (ARCHITECTURE §6.6)",
      sqlText,
    );
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
