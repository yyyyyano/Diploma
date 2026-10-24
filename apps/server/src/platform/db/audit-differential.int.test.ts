// Дифференциальный тест аудитора SQL против настоящего Postgres (ADR-0006, ARCHITECTURE §15). Аудитор читает
// текст регулярками поверх своего лексера; здесь проверяется, что он читает его так же, как база. Одни и те же
// запросы записываются по-разному (пробел, таб, перевод строки, комментарии, ключевое слово вплотную к кавычке,
// регистр, "имя", public., ONLY, U&"…", E-строки со склейкой, $tag$…$tag$, «;» в конце), выбор — детерминированный
// (свой ГПСЧ с фиксированным зерном). Каждый вариант Postgres выполняет в транзакции с откатом, оракул — сама база:
//  - какие пользовательские таблицы запрос реально тронул — дельта pg_stat_xact_user_tables (видит и вставку
//    MERGE, и вторую команду через «;», а отброшенное планом `where false` — нет); FK-триггеры выключены
//    (session_replication_role = replica), чтобы проверка ссылки не считалась обращением;
//  - утёк ли чужой: в ответе есть данные домохозяйства B или отпечаток строк B изменился (вставка, правка, удаление).
// Утверждения: (1) таблицу, которую база тронула, аудитор видит — в режиме system (owned = {эта таблица}) запрос
// остановлен; (2) запрос, через который утекли данные B, остановлен и в режиме scoped. Лишний отказ допустим —
// ложные срабатывания считаются и выводятся в лог. Вариант, который Postgres не принял, отбрасывается.
// Полный прогон: AUDIT_DIFF_RUNS=<вариантов на запрос> (по умолчанию 24), AUDIT_DIFF_SEED=<зерно>.
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateFixtures } from "./__fixtures__/fixture-db.ts";
import { fxReceiptItems, fxReceipts, fxTransactions } from "./__fixtures__/schema.ts";
import { auditQuery, IsolationViolation, type AuditMode } from "./audit.ts";
import { createScopedDb } from "./scoped-db.ts";
import { ownedTableNames } from "./tables.ts";

const scopeA = testScope({ user: 1, household: 1 });
const scopeB = testScope({ user: 2, household: 2 });
const A = scopeA.householdId;
const B = scopeB.householdId;
const MARK_B = "CANARY-B";

const RUNS = Number(process.env["AUDIT_DIFF_RUNS"] ?? 24);
const SEED = Number(process.env["AUDIT_DIFF_SEED"] ?? 20_261_024);

let db: TestDb;
let client: pg.PoolClient;
let receiptB = "";

// ── Запросы: шаблон — токены через пробел; каждый пробел — «зазор», который вариант пишет по-своему ─────────
// K:слово — ключевое слово (регистр), T:имя — таблица (кавычки, public., ONLY, U&), C:кол — колонка (кавычки,
// регистр), Q:алиас.кол — квалифицированная колонка, % — необязательный «шумный» литерал в списке select,
// прочее — как есть. safe — с own у каждой таблицы, leak — данные B утекают, если база выполнит запрос.

interface Base {
  readonly name: string;
  readonly kind: "safe" | "leak";
  readonly template: string;
  readonly params: () => unknown[];
  /** safe, который аудитор всё же останавливает (известное ложное срабатывание, «громко» вместо «тихо»). */
  readonly falsePositive?: true;
}

const insertColumns = "( C:household_id , user_id , merchant , total_minor )";

const BASES: readonly Base[] = [
  {
    name: "чтение с own",
    kind: "safe",
    template: "K:select note % K:from T:fx_receipts K:where C:household_id = $1",
    params: () => [A],
  },
  {
    name: "чтение с own: $1 = household_id",
    kind: "safe",
    template: "K:select note % K:from T:fx_receipts K:where $1 = C:household_id",
    params: () => [A],
  },
  {
    name: "JOIN с own у обеих таблиц",
    kind: "safe",
    template:
      "K:select r.note , i.name % K:from T:fx_receipts A:r K:join T:fx_receipt_items A:i K:on Q:i.household_id = $1 " +
      "K:and i.receipt_id = r.id K:where Q:r.household_id = $1",
    params: () => [A],
  },
  {
    name: "подзапрос с own",
    kind: "safe",
    template:
      "K:select note K:from T:fx_receipts K:where C:household_id = $1 K:and id K:in ( K:select receipt_id " +
      "K:from T:fx_receipt_items K:where C:household_id = $1 )",
    params: () => [A],
  },
  {
    name: "CTE с own",
    kind: "safe",
    template:
      "K:with m K:as ( K:select * K:from T:fx_receipts K:where C:household_id = $1 ) K:select note % K:from m",
    params: () => [A],
  },
  {
    name: "самосоединение с own у обоих",
    kind: "safe",
    template:
      "K:select a.note K:from T:fx_receipts A:a , T:fx_receipts A:b K:where Q:a.household_id = $1 " +
      "K:and Q:b.household_id = $1",
    params: () => [A],
  },
  {
    name: "FOR UPDATE и $1::uuid",
    kind: "safe",
    template: "K:select id K:from T:fx_receipts K:where C:household_id = $1::uuid K:for K:update",
    params: () => [A],
  },
  {
    name: "UPDATE с own и RETURNING",
    kind: "safe",
    template: "K:update T:fx_receipts K:set note = $2 K:where C:household_id = $1 K:returning note",
    params: () => [A, "n"],
  },
  {
    name: "DELETE с own",
    kind: "safe",
    template: "K:delete K:from T:fx_transactions K:where C:household_id = $1 K:and id = $1",
    params: () => [A],
  },
  {
    name: "INSERT со своим household_id",
    kind: "safe",
    template: `K:insert K:into T:fx_receipts ${insertColumns} K:values ( $1 , $2 , 'm' , 1 ) K:returning id`,
    params: () => [A, scopeA.userId],
  },
  {
    name: "UPSERT ON CONFLICT (household_id, id) DO UPDATE",
    kind: "safe",
    template:
      `K:insert K:into T:fx_receipts ${insertColumns} K:values ( $1 , $2 , 'm' , 1 ) ` +
      "K:on K:conflict ( household_id , id ) K:do K:update K:set note = 'u'",
    params: () => [A, scopeA.userId],
  },
  {
    name: "алиас колонки совпадает с именем таблицы",
    kind: "safe",
    // Аудитор считает «as fx_receipts» вторым обращением без своего предиката.
    falsePositive: true,
    template: "K:select note K:as fx_receipts K:from T:fx_receipts K:where C:household_id = $1",
    params: () => [A],
  },
  {
    name: "чтение без фильтра",
    kind: "leak",
    template: "K:select note % K:from T:fx_receipts",
    params: () => [],
  },
  {
    name: "фильтр со значением чужого домохозяйства",
    kind: "leak",
    template: "K:select note % K:from T:fx_receipts K:where C:household_id = $1",
    params: () => [B],
  },
  {
    name: "JOIN без own у второй таблицы",
    kind: "leak",
    template:
      "K:select i.name % K:from T:fx_receipts A:r K:join T:fx_receipt_items A:i K:on K:true " +
      "K:where Q:r.household_id = $1",
    params: () => [A],
  },
  {
    name: "подзапрос без own",
    kind: "leak",
    template:
      "K:select ( K:select string_agg ( note , ',' ) K:from T:fx_receipts ) % K:from T:fx_transactions " +
      "K:where C:household_id = $1",
    params: () => [A],
  },
  {
    name: "CTE без own",
    kind: "leak",
    template: "K:with m K:as ( K:select * K:from T:fx_receipts ) K:select note % K:from m",
    params: () => [],
  },
  {
    name: "самосоединение: второй алиас без own",
    kind: "leak",
    template:
      "K:select b.note K:from T:fx_receipts A:a , T:fx_receipts A:b K:where Q:a.household_id = $1",
    params: () => [A],
  },
  {
    name: "UPDATE без own",
    kind: "leak",
    template: "K:update T:fx_receipts K:set note = $1",
    params: () => ["взлом"],
  },
  {
    name: "UPDATE … FROM без own у второй таблицы",
    kind: "leak",
    template:
      "K:update T:fx_receipts A:r K:set note = i.name K:from T:fx_receipt_items A:i " +
      "K:where Q:r.household_id = $1 K:and i.receipt_id = $2 K:returning i.name",
    params: () => [A, receiptB],
  },
  {
    name: "SET household_id переносит строки в B",
    kind: "leak",
    template: "K:update T:fx_receipts K:set C:household_id = $2 K:where C:household_id = $1",
    params: () => [A, B],
  },
  {
    name: "DELETE без own",
    kind: "leak",
    template: "K:delete K:from T:fx_transactions",
    params: () => [],
  },
  {
    name: "INSERT с чужим household_id",
    kind: "leak",
    template: `K:insert K:into T:fx_receipts ${insertColumns} K:values ( $1 , $2 , 'm' , 1 )`,
    params: () => [B, scopeA.userId],
  },
  {
    name: "INSERT … SELECT с чужим household_id",
    kind: "leak",
    template:
      `K:insert K:into T:fx_receipts ${insertColumns} K:select $2::uuid , user_id , merchant , total_minor ` +
      "K:from T:fx_receipts K:where C:household_id = $1",
    params: () => [A, B],
  },
  {
    name: "WITH … INSERT с чужим household_id",
    kind: "leak",
    template: `K:with x K:as ( K:select 1 ) K:insert K:into T:fx_receipts ${insertColumns} K:values ( $1 , $2 , 'm' , 1 )`,
    params: () => [B, scopeA.userId],
  },
  {
    name: "MERGE … WHEN NOT MATCHED THEN INSERT с чужим household_id",
    kind: "leak",
    template:
      "K:merge K:into T:fx_receipts A:t K:using ( K:select 1 ) x K:on K:false K:when K:not K:matched K:then " +
      "K:insert ( household_id , user_id , merchant , total_minor ) K:values ( $1 , $2 , 'm' , 1 )",
    params: () => [B, scopeA.userId],
  },
  {
    name: "WITH … MERGE с чужим household_id",
    kind: "leak",
    template:
      "K:with x K:as ( K:select 1 ) K:merge K:into T:fx_receipts A:t K:using x K:on K:false K:when K:not " +
      "K:matched K:then K:insert ( household_id , user_id , merchant , total_minor ) K:values ( $1 , $2 , 'm' , 1 )",
    params: () => [B, scopeA.userId],
  },
  {
    name: "вторая команда через «;»",
    kind: "leak",
    template: "K:select 1 ; K:update T:fx_receipts K:set note = 'взлом'",
    params: () => [],
  },
];

// ── Варианты записи ─────────────────────────────────────────────────────────────────────────────────────

/** mulberry32: детерминированный ГПСЧ — один и тот же SEED даёт те же варианты на любой машине. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Pick = <T>(options: readonly T[]) => T;

const GAPS = [
  " ",
  " ",
  " ",
  "\t",
  "\n",
  "\r\n",
  "  ",
  "",
  "/* c */",
  "/* /* n */ */",
  "/*'*/",
  '/*"*/',
  "--c\n",
  "--c\r",
  "-- ' \" ;\n",
];

function keyword(word: string, pick: Pick): string {
  return pick([
    word,
    word,
    word.toUpperCase(),
    word.replace(/[a-z]/g, (ch, i: number) => (i % 2 === 0 ? ch.toUpperCase() : ch)),
  ]);
}

function table(name: string, pick: Pick): string {
  const escaped = name.replace("_", String.raw`\005f`);
  return pick([
    name,
    name,
    `"${name}"`,
    `"${name}"`,
    `public.${name}`,
    `"public"."${name}"`,
    `PUBLIC."${name}"`,
    `public . ${name}`,
    name.toUpperCase(),
    `only ${name}`,
    `ONLY "${name}"`,
    `U&"${escaped}"`,
  ]);
}

function column(name: string, pick: Pick): string {
  return pick([name, name, `"${name}"`, name.toUpperCase()]);
}

function alias(name: string, pick: Pick): string {
  return pick([name, name, `as ${name}`, `"${name}"`, `AS "${name}"`]);
}

function qualified(text: string, pick: Pick): string {
  const [alias = "", col = ""] = text.split(".");
  const q = pick([alias, alias, `"${alias}"`]);
  return `${q}${pick([".", ".", " . ", "/**/."])}${column(col, pick)}`;
}

const NOISE = [
  "",
  "",
  ", E'a\\'b'",
  ", E'x'\n'y'",
  ", E'\\\\'",
  ", $q$ ; from fx_receipts $q$",
  ", $$ ' $$",
  ", '/*'",
  ", ' -- '",
  ", 'a''b'",
  ", U&'\\0061'",
  ', 1 as"from"',
  ", E'x' --c\n'y'",
  ", E'\\'\r'z'",
  ", '*/'",
  ", $a$ $b$ ' $a$",
];

function render(template: string, pick: Pick): string {
  const tokens = template.split(" ").map((token) => {
    if (token.startsWith("K:")) return keyword(token.slice(2), pick);
    if (token.startsWith("T:")) return table(token.slice(2), pick);
    if (token.startsWith("C:")) return column(token.slice(2), pick);
    if (token.startsWith("Q:")) return qualified(token.slice(2), pick);
    if (token.startsWith("A:")) return alias(token.slice(2), pick);
    if (token === "%") return pick(NOISE);
    return token;
  });
  let text = pick(["", "", "\n", "/* lead */", "-- lead\n"]);
  for (const [i, token] of tokens.entries()) {
    if (token === "") continue;
    text += (i === 0 ? "" : pick(GAPS)) + token;
  }
  return text + pick(["", "", ";", " ;", ";\n", " -- tail", "/* tail */"]);
}

/** Канонический вариант (все зазоры — пробел) и RUNS случайных на каждый запрос. */
function variants(base: Base, index: number): string[] {
  const next = random(SEED + index * 7919);
  const pick: Pick = (options) => options[Math.floor(next() * options.length)] as never;
  const canonical: Pick = (options) => options[0] as never;
  const out = [render(base.template, canonical)];
  for (let n = 0; n < RUNS; n += 1) out.push(render(base.template, pick));
  return [...new Set(out)];
}

// ── Оракул: Postgres в транзакции с откатом ─────────────────────────────────────────────────────────────

const OWNED = ["fx_receipts", "fx_receipt_items", "fx_transactions"] as const;

interface Outcome {
  /** Postgres выполнил запрос (иначе вариант отбрасывается). */
  readonly ran: boolean;
  /** Пользовательские таблицы, которые запрос тронул (чтение, вставка, правка, удаление). */
  readonly touched: readonly string[];
  /** В ответе данные B или строки B изменились. */
  readonly leaked: boolean;
}

async function touchCounts(): Promise<Map<string, number>> {
  const { rows } = await client.query<{ relname: string; n: string }>(
    `select relname, seq_scan + coalesce(idx_scan, 0) + n_tup_ins + n_tup_upd + n_tup_del as n
       from pg_stat_xact_user_tables where schemaname = 'public'`,
  );
  return new Map(rows.map((r) => [r.relname, Number(r.n)]));
}

async function hashOfB(): Promise<string> {
  const { rows } = await client.query<{ hash: string | null }>(
    `select md5(string_agg(r, '|' order by r)) as hash from (
       select t::text as r from fx_receipts t where household_id = $1
       union all select t::text from fx_receipt_items t where household_id = $1
       union all select t::text from fx_transactions t where household_id = $1) x`,
    [B],
  );
  return rows[0]?.hash ?? "";
}

let hashB = "";

async function run(text: string, params: unknown[]): Promise<Outcome> {
  await client.query("begin; set local session_replication_role = replica");
  try {
    const before = await touchCounts();
    let result: unknown;
    try {
      // Как Drizzle (node-postgres): без параметров — простой протокол, «;» выполняет обе команды.
      result = await client.query({ text, values: params });
    } catch {
      return { ran: false, touched: [], leaked: false };
    }
    const after = await touchCounts();
    const touched = OWNED.filter((t) => (after.get(t) ?? 0) > (before.get(t) ?? 0));
    const results = (Array.isArray(result) ? result : [result]) as pg.QueryResult[];
    const answer = JSON.stringify(results.map((r) => r.rows));
    const leaked =
      answer.includes(MARK_B) ||
      answer.includes(B) ||
      answer.includes(receiptB) ||
      (await hashOfB()) !== hashB;
    return { ran: true, touched, leaked };
  } finally {
    await client.query("rollback");
  }
}

/** Причина отказа аудитора; undefined — запрос прошёл. */
function rejection(
  text: string,
  params: unknown[],
  mode: AuditMode,
  owned: ReadonlySet<string>,
): string | undefined {
  try {
    auditQuery(text, params, mode, owned);
    return undefined;
  } catch (error) {
    if (error instanceof IsolationViolation) return error.reason;
    throw error;
  }
}

const onlyTable = new Map<string, ReadonlySet<string>>(OWNED.map((t) => [t, new Set([t])]));
const scopedA: AuditMode = { kind: "scoped", householdId: A };
const system: AuditMode = { kind: "system" };

// ── Данные и прогон ─────────────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  db = await createTestDb();
  await migrateFixtures(db.pool);
  for (const [scope, label] of [
    [scopeA, "A"],
    [scopeB, MARK_B],
  ] as const) {
    const s = createScopedDb(db.pool, scope);
    const [receipt] = await s
      .insert(fxReceipts)
      .values({ merchant: `${label} магазин`, totalMinor: 1000, note: label })
      .returning();
    const id = receipt?.id ?? "";
    await s.insert(fxReceiptItems).values({ receiptId: id, name: `${label} хлеб`, sumMinor: 1000 });
    await s
      .insert(fxTransactions)
      .values({ description: label, amountMinor: -1000, receiptId: id });
    if (scope === scopeB) receiptB = id;
  }
  client = await db.pool.connect();
  hashB = await hashOfB();
});
afterAll(async () => {
  client.release();
  await db.drop();
});

describe("ROLE-01, SEC-04: аудитор читает запрос не слабее Postgres (дифференциальный тест)", () => {
  it("оракул различает: канонические safe не текут и проходят аудит, канонические leak текут", async () => {
    const observed = [];
    const expected = [];
    for (const base of BASES) {
      const text = render(base.template, (options) => options[0] as never);
      const outcome = await run(text, base.params());
      const rejected = rejection(text, base.params(), scopedA, ownedTableNames()) !== undefined;
      observed.push({ name: base.name, ran: outcome.ran, leaked: outcome.leaked, rejected });
      const leak = base.kind === "leak";
      expected.push({
        name: base.name,
        ran: true,
        leaked: leak,
        rejected: leak || base.falsePositive === true,
      });
    }
    expect(observed).toEqual(expected);
  });

  it(
    "ни один вариант, который Postgres выполнил, не тронул таблицу незаметно и не увёл данные B",
    async () => {
      const misses: string[] = [];
      const falsePositives: string[] = [];
      const byReason = new Map<string, number>();
      let total = 0;
      let ran = 0;
      for (const [index, base] of BASES.entries()) {
        for (const text of variants(base, index)) {
          total += 1;
          const params = base.params();
          const outcome = await run(text, params);
          if (!outcome.ran) continue;
          ran += 1;
          for (const t of outcome.touched) {
            if (rejection(text, params, system, onlyTable.get(t) ?? new Set()) === undefined) {
              misses.push(`[system не видит ${t}] ${base.name}: ${JSON.stringify(text)}`);
            }
          }
          const reason = rejection(text, params, scopedA, ownedTableNames());
          if (outcome.leaked && reason === undefined) {
            misses.push(`[scoped пропустил утечку] ${base.name}: ${JSON.stringify(text)}`);
          }
          if (!outcome.leaked && reason !== undefined) {
            falsePositives.push(`[${reason}] ${base.name}: ${JSON.stringify(text)}`);
            byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
          }
        }
      }
      // Итог прогона — в лог: ложные срабатывания допустимы, но их число и примеры видны.
      console.info(
        `аудитор против Postgres: вариантов ${total}, выполнено базой ${ran}, ` +
          `ложных срабатываний ${falsePositives.length} ${JSON.stringify(Object.fromEntries(byReason))}\n  ` +
          falsePositives.slice(0, 20).join("\n  "),
      );
      expect(misses).toEqual([]);
      // Генератор не должен вырождаться в синтаксические ошибки: большинство вариантов база выполняет.
      expect(ran).toBeGreaterThan(total / 2);
      // ~5 мс на вариант (транзакция и 5 запросов); запас — на параллельные файлы make check.
    },
    30_000 + RUNS * BASES.length * 20,
  );
});
