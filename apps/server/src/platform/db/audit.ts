// Аудитор SQL — замок 3 изоляции (ROLE-01, SEC-04, PRIV-07, ADR-0006, ARCHITECTURE §6.2). Чистая функция над
// итоговым текстом запроса: Drizzle вызывает её из Logger.logQuery ДО отправки (drizzle-orm 1.0.0-rc.5,
// pg-core/async/session.js), исключение отменяет запрос. Поэтому неважно, как запрос написан — построителем,
// JOIN, подзапросом, CTE или сырым sql: проверяется то, что ушло бы в базу.
//
// Что видит. Текст разбирается одним проходом лексера (scan) по правилам scan.l Postgres 18: строки ('…',
// E'…' и её продолжение за переводом строки, $tag$…$tag$), комментарии («--» до \n или \r, вложенные
// /* /* */ */), имена в кавычках (регистр сохраняется; имя с пробелом, «;», «=» — заглушка "Q_<hex>"), имена без
// кавычек — в нижний регистр только ASCII. Поэтому кавычка, «/*» или «--» внутри строки не прячет код, а код за
// «--…\r» виден. Дальше: одна команда из белого списка (select, insert, update, delete, with, values, транзакции;
// DO, COPY, CALL, SET, DDL и прочее — нарушение; MERGE — нигде в тексте: после WITH и в CTE он вставляет без
// «insert into», WHEN NOT MATCHED THEN INSERT), без U&"…" и без функций, исполняющих SQL из строки
// (query_to_xml, ts_stat, dblink…) или меняющих настройки соединения (set_config); у каждого обращения к
// пользовательской таблице, в том числе UPDATE/DELETE … RETURNING внутри CTE, — свой «household_id = $n» со
// значением домохозяйства scope; SET (в том числе кортежный) не меняет household_id; INSERT в пользовательскую
// таблицу — только отдельной командой в начале текста и только VALUES со своим household_id (WITH … INSERT и
// INSERT внутри CTE — нарушение: их строки не разобрать).
//
// Чего не видит — это проверка текста, а не доказательство: предикат, который не сужает выборку
// (`… OR true`, `NOT household_id = $1`, `household_id = $1` в списке select или в ветке CASE); к какой таблице
// относится предикат без квалификатора (предикаты считаются штуками: два `household_id = $1` без алиаса
// засчитываются двум обращениям); SQL внутри представлений и функций базы (их запрещает проверка схемы,
// schema-check.ts), SELECT … INTO. Лексер полагается на standard_conforming_strings = on (умолчание Postgres; SET и
// set_config аудитор не пропускает): при off обычная строка '…\'…' читалась бы иначе. Это закрывают построитель
// ScopedDb (s.own, s.update, s.delete ставят фильтр сами) и ревью сырого SQL. Ошибается аудитор в сторону
// «громко»: безвредный подзапрос без own тоже останавливается (правило «у каждой таблицы свой own»).

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
  | "HIDDEN_SQL";

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
  const parsed = parse(sqlText, owned);
  auditStatement(parsed, sqlText);
  if (mode.kind === "cross-tenant") {
    auditCrossTenant(parsed.text, sqlText);
    return;
  }
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
  /** Код запроса в нижнем регистре: строки — '', комментарии — пробел, `public.` снят. */
  readonly text: string;
  /** Первое слово команды (после открывающих скобок). */
  readonly command: string;
  /** После первой `;` есть ещё код. */
  readonly multiple: boolean;
  /** Имя в форме U&"…" или вызов функции, исполняющей SQL из строки. */
  readonly hidden: string | undefined;
  /** Обращения к пользовательским таблицам (кроме цели INSERT). */
  readonly refs: readonly Ref[];
  /** Предикаты `[алиас.]household_id = $n`. */
  readonly predicates: readonly Predicate[];
  /** Все упоминания пользовательских таблиц, включая цель INSERT. */
  readonly mentions: readonly string[];
  readonly insert: Insert | undefined;
  /** Пользовательская таблица, в которую вставляет INSERT не в начале текста (WITH … INSERT, INSERT в CTE). */
  readonly nestedInsert: string | undefined;
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

const PREDICATE = /(?:(?:"(\w+)"|\b(\w+))\s*\.\s*)?(?<![\w"$])"?household_id"?\s*=\s*\$(\d+)\b/g;
const PREDICATE_REVERSED =
  /\$(\d+)\s*=\s*(?:(?:"(\w+)"|\b(\w+))\s*\.\s*)?"?household_id"?(?![\w"$])/g;

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
  const scanned = scan(sqlText, "''", true);
  const text = scanned.code.replace(/(?<![\w."$])"?public"?\s*\.\s*/g, "");
  const insert = parseInsert(text, owned);
  // VALUES разбирается только у INSERT в начале текста; иначе household_id строк не проверить.
  const nestedInsert = [...text.matchAll(INSERT_TARGET)]
    .filter((m) => text.slice(0, m.index).trim() !== "")
    .map((m) => m[1] ?? m[2] ?? "")
    .find((table) => owned.has(table));
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
  // Присваивание household_id в SET (UPDATE, ON CONFLICT DO UPDATE), в том числе кортежное
  // `SET (household_id, …) = (…)`, запрещено целиком — поэтому такое «household_id = $n» и не фильтр.
  const ownerChange = setClauses(text).some(([from, to]) =>
    splitTopLevel(text.slice(from, to)).some((item) => setTargets(item).includes("household_id")),
  )
    ? (insert?.table ?? refs[0]?.table)
    : undefined;
  const command = /^[\s(]*([a-z_]+)/.exec(text)?.[1] ?? "";
  const multiple = text.replace(/;\s*$/, "").includes(";");
  const hidden = scanned.unicodeIdentifier ? 'U&"…"' : HIDDEN_SQL_CALL.exec(text)?.[1];
  return {
    text,
    command,
    multiple,
    hidden,
    refs,
    predicates,
    mentions,
    insert,
    nestedInsert,
    ownerChange,
  };
}

const INSERT_TARGET = /(?<![\w"$])insert\s+into\s+(?:"(\w+)"|(\w+)\b)(?!\s*\.)/g;

/** Колонки слева от `=` в элементе SET: `col`, `"col"`, `(a, b)`, `col[1]`, `col.field`. */
function setTargets(item: string): string[] {
  const target = item.split("=")[0] ?? "";
  return target
    .replace(/[()"\s]/g, "")
    .split(",")
    .map((name) => name.split(/[.[]/)[0] ?? "");
}

/**
 * Функции, исполняющие SQL или читающие таблицу по имени из строки (аудитор строки не разбирает), и set_config —
 * настройка (search_path), которая осталась бы на соединении пула для следующих запросов.
 */
const HIDDEN_SQL_CALL = new RegExp(
  String.raw`(?<![\w$])"?(` +
    [
      "(?:query|table|cursor|schema|database)_to_xml(?:schema|_and_xmlschema)?",
      "ts_stat",
      "ts_rewrite",
      "dblink\\w*",
      "set_config",
    ].join("|") +
    String.raw`)"?\s*\(`,
);

/** Первые слова разрешённых команд (Drizzle: запросы, транзакции, SAVEPOINT, setTransaction). */
const ALLOWED_COMMANDS = new Set(
  "select insert update delete with values begin commit rollback savepoint release".split(" "),
);

/** MERGE в любом месте текста: имя в кавычках ("merge") — не ключевое слово, колонка merge без into — не команда. */
const MERGE_ANYWHERE = /(?<![\w"$.])merge\s+into(?![\w"$])/;

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

interface Scanned {
  /** Текст, где строка заменена на `literal`, комментарий — на пробел; имена в кавычках — как есть. */
  readonly code: string;
  /** Встретилось имя U&"…": в нём экранирование (\005f) прячет имя таблицы от сравнения. */
  readonly unicodeIdentifier: boolean;
}

const WORD = /[A-Za-z_\u0080-\uffff][\w$\u0080-\uffff]*/y;
const LINE_END = /[\n\r]/g;
/**
 * Склейка строк в scan.l: пробелы и «--»-комментарии с хотя бы одним \n или \r между литералами
 * (whitespace_with_newline; \v — пробел с PostgreSQL 16). «/* *\/» склейку не даёт — синтаксическая ошибка.
 * Каждый символ разбирается одним способом (откат линейный): до первого перевода строки комментарий может быть
 * только последним — он тянется до \n; после — по одному пробелу или комментарию с его переводом строки.
 * Вложенные квантификаторы `(a+|…)*` давали 2^n шагов на неудаче — зависание корректного запроса.
 */
const CONTINUATION = /[ \t\f\v]*(?:--[^\n\r]*)?[\n\r](?:[ \t\n\r\f\v]|--[^\n\r]*[\n\r])*'/y;
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$/y;

/**
 * Лексер одним проходом: что строка, что комментарий, что имя — решается слева направо, как в Postgres
 * (standard_conforming_strings = on). Незакрытая строка или комментарий тянутся до конца текста: такой
 * запрос база отвергнет синтаксической ошибкой.
 */
function scan(sqlText: string, literal: string, normalize: boolean): Scanned {
  let code = "";
  let unicodeIdentifier = false;
  let i = 0;
  while (i < sqlText.length) {
    const ch = sqlText.charAt(i);
    const next = sqlText.charAt(i + 1);
    if (ch === "-" && next === "-") {
      // Комментарий кончается на \n или \r (non_newline [^\n\r] в scan.l Postgres).
      LINE_END.lastIndex = i;
      i = LINE_END.exec(sqlText) === null ? sqlText.length : LINE_END.lastIndex - 1;
      code += " ";
    } else if (ch === "/" && next === "*") {
      i = blockCommentEnd(sqlText, i);
      code += " ";
    } else if (ch === "'") {
      i = quotedEnd(sqlText, i, false);
      code += literal;
    } else if (ch === '"') {
      const end = quotedEnd(sqlText, i, false);
      const name = sqlText.slice(i, end);
      code += normalize ? quotedName(name) : name;
      i = end;
    } else if (ch === "$") {
      DOLLAR_TAG.lastIndex = i;
      const tag = DOLLAR_TAG.exec(sqlText)?.[0];
      if (tag === undefined) {
        code += ch;
        i += 1;
      } else {
        const close = sqlText.indexOf(tag, i + tag.length);
        i = close < 0 ? sqlText.length : close + tag.length;
        code += literal;
      }
    } else if ((ch === "u" || ch === "U") && next === "&" && /["']/.test(sqlText.charAt(i + 2))) {
      const end = quotedEnd(sqlText, i + 2, false);
      if (sqlText.charAt(i + 2) === '"') {
        unicodeIdentifier = true;
        code += sqlText.slice(i + 2, end);
      } else code += literal;
      i = end;
    } else {
      WORD.lastIndex = i;
      const word = /[A-Za-z_\u0080-\uffff]/.test(ch) ? (WORD.exec(sqlText)?.[0] ?? ch) : ch;
      const prefix = word.toLowerCase();
      if (sqlText.charAt(i + word.length) === "'" && ["e", "b", "x", "n"].includes(prefix)) {
        // E'…' — с экранированием обратной косой чертой; B'…', X'…', N'…' — как обычная строка.
        i = quotedEnd(sqlText, i + 1, prefix === "e");
        // Продолжение E'…' за переводом строки ('a'\n'b') — та же E-строка, с тем же экранированием.
        while (prefix === "e") {
          CONTINUATION.lastIndex = i;
          if (CONTINUATION.exec(sqlText) === null) break;
          i = quotedEnd(sqlText, CONTINUATION.lastIndex - 1, true);
        }
        code += literal;
      } else {
        // Postgres приводит к нижнему регистру только ASCII в именах без кавычек.
        code += normalize ? word.replace(/[A-Z]+/g, (upper) => upper.toLowerCase()) : word;
        i += word.length;
      }
    }
  }
  return { code, unicodeIdentifier };
}

/** Позиция после закрывающей кавычки (удвоенная кавычка — экранирование; в E'…' ещё и `\\`). */
function quotedEnd(text: string, open: number, backslash: boolean): number {
  const quote = text.charAt(open);
  let i = open + 1;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (backslash && ch === "\\") i += 2;
    else if (ch === quote && text.charAt(i + 1) === quote) i += 2;
    else if (ch === quote) return i + 1;
    else i += 1;
  }
  return text.length;
}

/**
 * Имя в кавычках для разбора. `"\w+"` остаётся как есть: Postgres сравнивает его с учётом регистра, а имена без
 * кавычек приведены к нижнему регистру — поэтому "A" и a — разные алиасы, а "fx_receipts" — та же таблица. Прочие
 * имена (пробел, «;», «=», `""`) — в "Q_<hex>": `" household_id = $1"` не выглядит предикатом, «;» не делит
 * команды, разные имена не сливаются, а с именем без кавычек (нижний регистр) или `"\w+"` (не на Q_) не совпадут.
 */
function quotedName(name: string): string {
  if (/^"\w+"$/.test(name) && !name.startsWith('"Q_')) return name;
  let hex = "";
  for (let i = 1; i < name.length; i += 1) hex += name.charCodeAt(i).toString(16).padStart(4, "0");
  return `"Q_${hex}"`;
}

/** Позиция после комментария `/* … *\/`; в Postgres такие комментарии вкладываются. */
function blockCommentEnd(text: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    if (text.startsWith("/*", i)) {
      depth += 1;
      i += 2;
    } else if (text.startsWith("*/", i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) return i;
    } else i += 1;
  }
  return text.length;
}

/** Текст для сообщения: без комментариев, строки заменены на '…', не длиннее 300 символов. */
function maskSql(sqlText: string): string {
  const masked = scan(sqlText, "'…'", false).code.replace(/\s+/g, " ").trim();
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

/** Для всех режимов: одна команда из белого списка, без SQL, спрятанного в строку или имя. */
function auditStatement(parsed: Parsed, sqlText: string): void {
  const { command, text } = parsed;
  if (!ALLOWED_COMMANDS.has(command) && !/^\s*set\s+transaction(?![\w"$])/.test(text)) {
    throw new IsolationViolation(
      "STATEMENT_NOT_ALLOWED",
      undefined,
      `команда «${command.slice(0, 20)}» недоступна через ScopedDb, SystemDb и crossTenant: только select, ` +
        "insert, update, delete, with, values и транзакции; DDL и обслуживание — миграции (platform/db/migrate.ts)",
      sqlText,
    );
  }
  if (MERGE_ANYWHERE.test(text)) {
    // MERGE пишет без «insert into» (WHEN NOT MATCHED THEN INSERT) и разрешён в WITH и в CTE — его строки не разобрать.
    throw new IsolationViolation(
      "STATEMENT_NOT_ALLOWED",
      undefined,
      "MERGE недоступен через ScopedDb, SystemDb и crossTenant, в том числе после WITH и внутри CTE: " +
        "вставка — s.insert(…).values(…), правка — s.update(…), удаление — s.delete(…)",
      sqlText,
    );
  }
  if (parsed.multiple) {
    throw new IsolationViolation(
      "MULTIPLE_STATEMENTS",
      undefined,
      "в одном запросе несколько команд через «;» — отправляйте каждую отдельным запросом",
      sqlText,
    );
  }
  if (parsed.hidden !== undefined) {
    throw new IsolationViolation(
      "HIDDEN_SQL",
      undefined,
      `${parsed.hidden}: SQL или имя таблицы внутри строки аудитор не проверяет — пишите запрос построителем ` +
        "или sql`…` с ${s.own(таблица)}; имена — без U&",
      sqlText,
    );
  }
}

function auditScoped(
  parsed: Parsed,
  params: readonly unknown[],
  householdId: string,
  sqlText: string,
): void {
  const { insert, nestedInsert } = parsed;
  if (nestedInsert !== undefined) {
    throw new IsolationViolation(
      "INSERT_NOT_STANDALONE",
      nestedInsert,
      `вставка в ${nestedInsert} внутри WITH или CTE: household_id её строк не проверить — вставка только ` +
        `отдельной командой s.insert(${nestedInsert}).values(…)`,
      sqlText,
    );
  }
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

function auditCrossTenant(code: string, sqlText: string): void {
  const text = code.trim();
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
