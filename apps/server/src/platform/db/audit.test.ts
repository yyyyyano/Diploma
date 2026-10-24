// Канарейки аудитора SQL (ADR-0006, ARCHITECTURE §6.2 замок 3): заведомо дырявые запросы должны остановиться,
// правильные формы — пройти. SQL для типичных форм строит сам Drizzle (drizzle.mock() + toSQL()), чтобы канарейки
// краснели, если обновление Drizzle изменит текст запросов; нетипичные формы — сырым текстом.
import { and, eq, inArray, sql, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { alias, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { fxRates, fxReceiptItems, fxReceipts, fxSettings } from "./__fixtures__/schema.ts";
import { auditQuery, IsolationViolation, type AuditMode } from "./audit.ts";
import { ownedTableNames } from "./tables.ts";

const A = "00000000-0000-7000-8200-00000000000a";
const B = "00000000-0000-7000-8200-00000000000b";
const scopedA: AuditMode = { kind: "scoped", householdId: A };
const system: AuditMode = { kind: "system" };
const crossTenant: AuditMode = { kind: "cross-tenant" };

const db = drizzle.mock();
const dialect = new PgDialect();
const own = (t: typeof fxReceipts | typeof fxReceiptItems, householdId = A) =>
  eq(t.householdId, householdId);

type Query = { toSQL(): { sql: string; params: unknown[] } };

const mine = db.$with("mine").as(db.select().from(fxReceipts).where(own(fxReceipts)));

function audit(query: Query | { sql: string; params: unknown[] }, mode: AuditMode = scopedA): void {
  const { sql: text, params } = "toSQL" in query ? query.toSQL() : query;
  auditQuery(text, params, mode, ownedTableNames());
}

function violation(run: () => void): IsolationViolation {
  try {
    run();
  } catch (error) {
    if (error instanceof IsolationViolation) return error;
    throw error;
  }
  throw new Error("ожидалось ISOLATION_VIOLATION, а запрос прошёл аудит");
}

describe("ROLE-01, SEC-04: аудитор пропускает правильные формы", () => {
  it.each<[string, Query]>([
    [
      "чтение по id со своим own",
      db
        .select()
        .from(fxReceipts)
        .where(and(own(fxReceipts), eq(fxReceipts.id, "x"))),
    ],
    [
      "JOIN: у каждой таблицы свой own",
      db
        .select({ id: fxReceipts.id, name: fxReceiptItems.name })
        .from(fxReceipts)
        .leftJoin(
          fxReceiptItems,
          and(own(fxReceiptItems), eq(fxReceiptItems.receiptId, fxReceipts.id)),
        )
        .where(own(fxReceipts)),
    ],
    [
      "агрегат с фильтром",
      db
        .select({ total: sum(fxReceipts.totalMinor) })
        .from(fxReceipts)
        .where(own(fxReceipts)),
    ],
    [
      "подзапрос IN с двумя own",
      db
        .select()
        .from(fxReceipts)
        .where(
          and(
            own(fxReceipts),
            inArray(
              fxReceipts.id,
              db
                .select({ id: fxReceiptItems.receiptId })
                .from(fxReceiptItems)
                .where(own(fxReceiptItems)),
            ),
          ),
        ),
    ],
    ["CTE с own внутри", db.with(mine).select().from(mine)],
    [
      "UPDATE с own",
      db
        .update(fxReceipts)
        .set({ status: "ok" })
        .where(and(own(fxReceipts), eq(fxReceipts.id, "x"))),
    ],
    ["DELETE с own", db.delete(fxReceipts).where(and(own(fxReceipts), eq(fxReceipts.id, "x")))],
    [
      "многострочный INSERT своего домохозяйства",
      db.insert(fxReceipts).values([
        { householdId: A, userId: "u", merchant: "m", totalMinor: 1 },
        { householdId: A, userId: "u", merchant: "m2", totalMinor: 2, note: "n" },
      ]),
    ],
    [
      "UPSERT по (household_id, id)",
      db
        .insert(fxReceipts)
        .values({ householdId: A, userId: "u", merchant: "m", totalMinor: 1 })
        .onConflictDoUpdate({
          target: [fxReceipts.householdId, fxReceipts.id],
          set: { status: "x" },
        }),
    ],
    ["общая таблица без фильтра", db.select().from(fxRates)],
    ["системная таблица без фильтра", db.select().from(fxSettings)],
    [
      "сырой sql с фильтром параметром",
      {
        toSQL: () => dialect.sqlToQuery(sql`select id from ${fxReceipts} where ${own(fxReceipts)}`),
      },
    ],
  ])("%s", (_name, query) => {
    expect(() => audit(query)).not.toThrow();
  });

  it.each([
    "begin",
    "commit",
    "rollback",
    "savepoint sp1",
    "release savepoint sp1",
    "rollback to savepoint sp1",
    "select 1",
  ])("служебная команда «%s» проходит", (text) => {
    expect(() => audit({ sql: text, params: [] })).not.toThrow();
  });

  it("имя таблицы только в строке или комментарии — не обращение", () => {
    expect(() =>
      audit({
        sql: "select 'from fx_receipts' as t /* fx_receipts */ -- fx_receipts\n",
        params: [],
      }),
    ).not.toThrow();
  });

  it("самосоединение: у обоих обращений свой own", () => {
    const other = alias(fxReceiptItems, "other");
    const query = db
      .select({ name: other.name })
      .from(fxReceiptItems)
      .innerJoin(other, and(eq(other.householdId, A), eq(other.name, fxReceiptItems.name)))
      .where(own(fxReceiptItems));
    expect(() => audit(query)).not.toThrow();
  });
});

describe("ROLE-01, SEC-04: аудитор останавливает дырявые запросы — ISOLATION_VIOLATION", () => {
  it("забытый where: чтение по id без own называет таблицу и что добавить", () => {
    const error = violation(() =>
      audit(db.select().from(fxReceipts).where(eq(fxReceipts.id, "x"))),
    );
    expect(error.code).toBe("ISOLATION_VIOLATION");
    expect(error.reason).toBe("MISSING_HOUSEHOLD_FILTER");
    expect(error.table).toBe("fx_receipts");
    expect(error.message).toMatch(/fx_receipts/);
    expect(error.message).toMatch(/s\.own\(/);
  });

  it("второй where в $dynamic() затёр own", () => {
    const query = db
      .select()
      .from(fxReceipts)
      .where(own(fxReceipts))
      .$dynamic()
      .where(eq(fxReceipts.id, "x"));
    expect(violation(() => audit(query)).reason).toBe("MISSING_HOUSEHOLD_FILTER");
  });

  it("JOIN без own у второй таблицы — называет её", () => {
    const query = db
      .select({ id: fxReceipts.id, name: fxReceiptItems.name })
      .from(fxReceipts)
      .leftJoin(fxReceiptItems, eq(fxReceiptItems.receiptId, fxReceipts.id))
      .where(own(fxReceipts));
    expect(violation(() => audit(query)).table).toBe("fx_receipt_items");
  });

  it("самосоединение: второй алиас без own («такие же позиции у других»)", () => {
    const other = alias(fxReceiptItems, "other");
    const query = db
      .select({ name: other.name })
      .from(fxReceiptItems)
      .innerJoin(other, eq(other.name, fxReceiptItems.name))
      .where(own(fxReceiptItems));
    expect(violation(() => audit(query)).message).toMatch(/fx_receipt_items \(other\)/);
  });

  it("подзапрос без own внутри", () => {
    const query = db
      .select()
      .from(fxReceipts)
      .where(
        and(
          own(fxReceipts),
          inArray(fxReceipts.id, db.select({ id: fxReceiptItems.receiptId }).from(fxReceiptItems)),
        ),
      );
    expect(violation(() => audit(query)).table).toBe("fx_receipt_items");
  });

  it("CTE без own внутри", () => {
    const all = db.$with("all_receipts").as(db.select().from(fxReceipts));
    expect(violation(() => audit(db.with(all).select().from(all))).table).toBe("fx_receipts");
  });

  it("агрегат по всем домохозяйствам", () => {
    expect(
      violation(() => audit(db.select({ s: sum(fxReceipts.totalMinor) }).from(fxReceipts))).table,
    ).toBe("fx_receipts");
  });

  it("сырой sql без фильтра", () => {
    expect(violation(() => audit({ sql: "select * from fx_receipts", params: [] })).table).toBe(
      "fx_receipts",
    );
  });

  it("литерал вместо параметра не засчитывается", () => {
    const text = `select * from fx_receipts where household_id = '${A}'`;
    expect(violation(() => audit({ sql: text, params: [] })).reason).toBe(
      "MISSING_HOUSEHOLD_FILTER",
    );
  });

  it("фильтр со значением чужого домохозяйства: проверяется значение, а не наличие предиката", () => {
    const query = db.select().from(fxReceipts).where(own(fxReceipts, B));
    expect(violation(() => audit(query)).reason).toBe("MISSING_HOUSEHOLD_FILTER");
  });

  it("UPDATE по id без own", () => {
    expect(
      violation(() =>
        audit(db.update(fxReceipts).set({ status: "x" }).where(eq(fxReceipts.id, "x"))),
      ).table,
    ).toBe("fx_receipts");
  });

  it("DELETE по id без own", () => {
    expect(violation(() => audit(db.delete(fxReceipts).where(eq(fxReceipts.id, "x")))).table).toBe(
      "fx_receipts",
    );
  });

  it("UPDATE … FROM: вторая таблица без own", () => {
    const text =
      "update fx_receipts set status = $1 from fx_receipt_items where fx_receipts.household_id = $2 and fx_receipt_items.receipt_id = fx_receipts.id";
    expect(violation(() => audit({ sql: text, params: ["x", A] })).table).toBe("fx_receipt_items");
  });

  it("UPDATE переносит строку в другое домохозяйство (SET household_id)", () => {
    const text =
      "update fx_receipts set household_id = $1 where fx_receipts.household_id = $2 and id = $3";
    expect(violation(() => audit({ sql: text, params: [B, A, "x"] })).reason).toBe("OWNER_CHANGE");
  });

  it("INSERT с чужим household_id во второй строке", () => {
    const query = db.insert(fxReceipts).values([
      { householdId: A, userId: "u", merchant: "m", totalMinor: 1 },
      { householdId: B, userId: "u", merchant: "m", totalMinor: 1 },
    ]);
    expect(violation(() => audit(query)).reason).toBe("INSERT_FOREIGN_HOUSEHOLD");
  });

  it("INSERT без колонки household_id", () => {
    const text = "insert into fx_receipts (user_id, merchant, total_minor) values ($1, $2, $3)";
    expect(violation(() => audit({ sql: text, params: ["u", "m", 1] })).reason).toBe(
      "INSERT_WITHOUT_HOUSEHOLD",
    );
  });

  it("INSERT … SELECT в пользовательскую таблицу", () => {
    const text =
      "insert into fx_receipts (household_id, user_id, merchant, total_minor) select household_id, user_id, merchant, total_minor from fx_receipts where household_id = $1";
    expect(violation(() => audit({ sql: text, params: [A] })).reason).toBe("INSERT_SELECT");
  });

  it("UPSERT ON CONFLICT (id) — цель без household_id", () => {
    const query = db
      .insert(fxReceipts)
      .values({ householdId: A, userId: "u", merchant: "m", totalMinor: 1 })
      .onConflictDoUpdate({ target: fxReceipts.id, set: { status: "x" } });
    expect(violation(() => audit(query)).reason).toBe("UPSERT_TARGET");
  });

  it.each([
    ["public.fx_receipts", "select * from public.fx_receipts"],
    ['"public"."fx_receipts"', 'select * from "public"."fx_receipts"'],
    ["заглавными буквами", "SELECT * FROM FX_RECEIPTS"],
    [
      "через запятую",
      "select * from fx_receipts, fx_receipt_items where fx_receipts.household_id = $1",
    ],
    [
      "фильтр не на том алиасе",
      "select * from fx_receipts r join fx_receipt_items i on i.receipt_id = r.id where i.household_id = $1 and i.household_id = $1",
    ],
    [
      "одна проверка на два обращения",
      "with c as (select * from fx_receipts) select * from fx_receipts where fx_receipts.household_id = $1",
    ],
  ])("имя таблицы в форме %s — обращение без фильтра", (_name, text) => {
    expect(violation(() => audit({ sql: text, params: [A] })).reason).toBe(
      "MISSING_HOUSEHOLD_FILTER",
    );
  });

  it("в тексте нарушения нет значений параметров и строковых литералов (OBS-04)", () => {
    const text = "select * from fx_receipts where merchant = $1 and note = 'CANARY-LITERAL'";
    const error = violation(() => audit({ sql: text, params: ["CANARY-PARAM"] }));
    expect(error.message).not.toMatch(/CANARY-PARAM|CANARY-LITERAL/);
    expect(error.message).toMatch(/fx_receipts/);
  });

  it("разбор кэшируется по тексту, а решение — нет: тот же текст с чужим значением остановлен", () => {
    const text = 'select * from "fx_receipts" where "fx_receipts"."household_id" = $1';
    expect(() => audit({ sql: text, params: [A] })).not.toThrow();
    expect(violation(() => audit({ sql: text, params: [B] })).reason).toBe(
      "MISSING_HOUSEHOLD_FILTER",
    );
  });
});

describe("ROLE-01, SEC-04: формы, которые прячут обращение от разбора, — ISOLATION_VIOLATION", () => {
  it.each([
    [
      "UPDATE: кортежный SET переносит строку в другое домохозяйство",
      "update fx_receipts set (household_id, status) = ($1, $2) where fx_receipts.household_id = $3",
      [B, "x", A],
    ],
    [
      "UPDATE: household_id не первый в кортежном SET",
      'update fx_receipts set ("status", "household_id") = ($1, $2) where fx_receipts.household_id = $3',
      ["x", B, A],
    ],
    [
      "UPSERT: кортежный SET в ON CONFLICT DO UPDATE",
      "insert into fx_receipts (household_id, user_id) values ($1, $2) on conflict (household_id, id) do update set (household_id) = row($3)",
      [A, "u", B],
    ],
  ])("%s → OWNER_CHANGE", (_name, text, params) => {
    expect(violation(() => audit({ sql: text, params })).reason).toBe("OWNER_CHANGE");
  });

  it("литералы '/*' и '*/' не стирают код между ними: подзапрос без own виден", () => {
    const text =
      "select '/*', (select count(*) from fx_receipt_items), '*/' as c from fx_receipts where fx_receipts.household_id = $1";
    expect(violation(() => audit({ sql: text, params: [A] })).table).toBe("fx_receipt_items");
  });

  it("«--» внутри литерала не гасит остаток строки", () => {
    const text =
      "select '--' as c, (select count(*) from fx_receipt_items) from fx_receipts where fx_receipts.household_id = $1";
    expect(violation(() => audit({ sql: text, params: [A] })).table).toBe("fx_receipt_items");
  });

  it("кавычка внутри комментария не открывает строку и не прячет код за ней", () => {
    const text =
      "select 1 /* ' */ , (select count(*) from fx_receipt_items) /* ' */ from fx_receipts where fx_receipts.household_id = $1";
    expect(violation(() => audit({ sql: text, params: [A] })).table).toBe("fx_receipt_items");
  });

  it("вложенный комментарий /* /* */ */ закрывается целиком, код после него виден", () => {
    const text =
      "select 1 /* a /* b */ c */, (select count(*) from fx_receipt_items) from fx_receipts where fx_receipts.household_id = $1";
    expect(violation(() => audit({ sql: text, params: [A] })).table).toBe("fx_receipt_items");
  });

  it.each([
    ["DO $$ … $$", "do $$ begin perform 1 from fx_receipts; end $$"],
    ["COPY", "copy fx_receipts to stdout"],
    ["COPY (запрос)", "copy (select * from fx_receipts where household_id = $1) to stdout"],
    ["CALL", "call some_proc()"],
    ["EXECUTE", "execute stmt1"],
    ["PREPARE", "prepare stmt1 as select * from fx_receipts"],
    ["SET search_path", "set search_path = other"],
    ["RESET", "reset all"],
    ["DDL", "create table fx_copy as select * from fx_receipts"],
    ["TRUNCATE", "truncate fx_receipts"],
    ["MERGE", "merge into fx_receipts using fx_rates on true when matched then delete"],
    ["TABLE", "table fx_receipts"],
  ])("команда вне белого списка (%s) → STATEMENT_NOT_ALLOWED", (_name, text) => {
    expect(violation(() => audit({ sql: text, params: [A] })).reason).toBe("STATEMENT_NOT_ALLOWED");
    expect(violation(() => audit({ sql: text, params: [A] }, system)).reason).toBe(
      "STATEMENT_NOT_ALLOWED",
    );
  });

  it.each([
    ["select 1; delete from fx_receipts", "select 1; delete from fx_receipts"],
    ["две команды с own", "select 1 from fx_rates; select 1 from fx_rates"],
  ])("несколько команд в одном тексте (%s) → MULTIPLE_STATEMENTS", (_name, text) => {
    expect(violation(() => audit({ sql: text, params: [A] })).reason).toBe("MULTIPLE_STATEMENTS");
    expect(violation(() => audit({ sql: text, params: [A] }, system)).reason).toBe(
      "MULTIPLE_STATEMENTS",
    );
  });

  it.each([
    ["query_to_xml", "select query_to_xml('select * from fx_receipts', true, false, '')"],
    [
      "pg_catalog.query_to_xml в кавычках",
      'select "pg_catalog"."query_to_xml"($1, true, false, \'\')',
    ],
    ["table_to_xml", "select table_to_xml('fx_receipts', true, false, '')"],
    ["ts_stat", "select * from ts_stat('select to_tsvector(merchant) from fx_receipts')"],
    ["dblink", "select * from dblink('dbname=x', 'select 1') as t(a int)"],
    ["set_config", "select set_config('search_path', 'other', false)"],
    ['U&"…" — имя таблицы с экранированием', 'select * from U&"fx\\005freceipts"'],
  ])("SQL, спрятанный в строку или имя (%s) → HIDDEN_SQL", (_name, text) => {
    expect(violation(() => audit({ sql: text, params: [A] })).reason).toBe("HIDDEN_SQL");
    expect(violation(() => audit({ sql: text, params: [A] }, system)).reason).toBe("HIDDEN_SQL");
  });

  it.each([
    ["begin с уровнем изоляции", "begin isolation level serializable"],
    ["set transaction (Drizzle setTransaction)", "set transaction read only"],
    ["union в скобках", "(select 1 from fx_rates) union (select 1 from fx_rates)"],
    ["values", "values (1), (2)"],
    ["точка с запятой в конце", "select 1;"],
    ["; и -- внутри строки", "select ';' as a, '--' as b, '/*' as c"],
    ["E-строка с экранированной кавычкой", "select E'it\\'s; delete' as a"],
    ["$tag$-строка", "select $body$ ; delete from fx_receipts $body$ as a"],
    ["кавычки внутри имени", 'select 1 as "a""b"'],
  ])("правильная форма проходит: %s", (_name, text) => {
    expect(() => audit({ sql: text, params: [] })).not.toThrow();
  });
});

describe("ROLE-01, SEC-04: лексер читает текст так же, как Postgres", () => {
  it("комментарий «--» кончается и на \\r: таблица после него видна", () => {
    const error = violation(() => audit({ sql: "select id -- x\rfrom fx_receipts", params: [] }));
    expect(error.reason).toBe("MISSING_HOUSEHOLD_FILTER");
    expect(error.table).toBe("fx_receipts");
  });

  it("комментарий «--» кончается и на \\r: вторая команда видна → MULTIPLE_STATEMENTS", () => {
    const text = "select 1 --\r; delete from fx_receipts";
    expect(violation(() => audit({ sql: text, params: [] })).reason).toBe("MULTIPLE_STATEMENTS");
    expect(violation(() => audit({ sql: text, params: [] }, system)).reason).toBe(
      "MULTIPLE_STATEMENTS",
    );
  });

  it("продолжение E-строки через перевод строки читается с экранированием: подзапрос виден", () => {
    // Postgres: E'x' + '\' , (select 1) ' — одна строка, дальше код с подзапросом к fx_receipts.
    const text =
      "select E'x'\n'\\' , (select 1) ', (select note from fx_receipts), '' as c from fx_rates";
    expect(violation(() => audit({ sql: text, params: [] })).table).toBe("fx_receipts");
  });

  // Разбор стоит на каждом запросе: откат регулярки на корректном тексте — зависание запроса, а не ошибка.
  const continuationTails: [string, string][] = [
    ["перевод строки и 60 пробелов", `\n${" ".repeat(60)}`],
    [
      "пробелы и «--»-комментарии вперемешку",
      ` -- a\n${"  -- c -- d\n   ".repeat(30)}${" ".repeat(40)}`,
    ],
    ["«--» без перевода строки до конца", ` ${"-- ".repeat(60)}\n${" ".repeat(60)}`],
  ];

  it.each(continuationTails)(
    "E-строка, %s и код: разбор за миллисекунды, подзапрос после виден",
    (_name, tail) => {
      const text = `select E'x'${tail}, (select note from fx_receipts) as c from fx_rates`;
      const started = performance.now();
      const error = violation(() => audit({ sql: text, params: [] }));
      expect(performance.now() - started).toBeLessThan(50);
      expect(error.table).toBe("fx_receipts");
    },
  );

  it.each(continuationTails)(
    "E-строка, %s и код без пользовательских таблиц: проходит за миллисекунды",
    (_name, tail) => {
      const text = `select E'x'${tail}as c from fx_rates`;
      const started = performance.now();
      expect(() => audit({ sql: text, params: [] })).not.toThrow();
      expect(performance.now() - started).toBeLessThan(50);
    },
  );

  it("имя в кавычках с заглавными — другой алиас: «A» и a не путаются", () => {
    const text =
      'select * from fx_receipts "A", fx_receipts a where a.household_id = $1 and a.household_id = $1';
    const error = violation(() => audit({ sql: text, params: [A] }));
    expect(error.reason).toBe("MISSING_HOUSEHOLD_FILTER");
    expect(error.message).toMatch(/fx_receipts \(A\)/);
  });

  it("имя в кавычках с «household_id = $1» внутри — не предикат", () => {
    const text = 'select id as " household_id = $1" from fx_receipts';
    expect(violation(() => audit({ sql: text, params: [A] })).table).toBe("fx_receipts");
  });

  it("«;» внутри имени в кавычках — не вторая команда", () => {
    expect(() => audit({ sql: 'select 1 as "a;b" from fx_rates', params: [] })).not.toThrow();
  });

  it.each([
    [
      "WITH … INSERT: значение household_id в VALUES не проверяется построчно",
      "with c as (select 1) insert into fx_receipts (household_id, user_id) values ($1, $2) " +
        "on conflict (household_id, id) do update set note = $3 where fx_receipts.household_id = $4",
      [B, "u", "x", A],
    ],
    [
      "INSERT внутри CTE, снаружи — чтение с own",
      "with x as (insert into fx_receipts (household_id, user_id) values ($1, $2) returning id) " +
        "select id from fx_receipts where fx_receipts.household_id = $3 and fx_receipts.household_id = $3",
      [B, "u", A],
    ],
    [
      "INSERT … SELECT внутри CTE в кавычках и с public.",
      'with x as (insert into "public"."fx_receipts" select * from fx_receipts where household_id = $1 ' +
        "returning id) select 1",
      [A],
    ],
  ])("%s → INSERT_NOT_STANDALONE", (_name, text, params) => {
    expect(violation(() => audit({ sql: text, params })).reason).toBe("INSERT_NOT_STANDALONE");
  });

  it.each([
    [
      "WITH … MERGE … WHEN NOT MATCHED THEN INSERT с чужим household_id (вставка без слова into)",
      "with x as (select 1) merge into fx_receipts t using x on t.household_id = $1 " +
        "when not matched then insert (household_id, user_id) values ($2, $3)",
      [A, B, "u"],
    ],
    [
      "WITH … MERGE … WHEN MATCHED THEN UPDATE SET household_id",
      "with x as (select 1) merge into fx_receipts t using x on t.household_id = $1 " +
        "when matched then update set household_id = $2",
      [A, B],
    ],
    [
      "MERGE внутри CTE (PostgreSQL 17+), снаружи — чтение с own",
      "with m as (merge into fx_receipts t using fx_rates r on t.household_id = $1 when matched then delete " +
        "returning t.id) select id from fx_receipts where household_id = $1 and household_id = $1",
      [A],
    ],
    [
      "MERGE в системную таблицу внутри WITH",
      "with x as (select 1) merge into fx_settings s using x on true when matched then delete",
      [],
    ],
  ])("%s → STATEMENT_NOT_ALLOWED во всех режимах", (_name, text, params) => {
    expect(violation(() => audit({ sql: text, params })).reason).toBe("STATEMENT_NOT_ALLOWED");
    expect(violation(() => audit({ sql: text, params }, system)).reason).toBe(
      "STATEMENT_NOT_ALLOWED",
    );
  });

  // Postgres читает from"t" как from + "t": ключевое слово кончается там, где начинается кавычка.
  it.each<[string, string, unknown[]]>([
    ['from"t" без фильтра', 'select note from"fx_receipts"', []],
    [
      'join"t" без own',
      'select 1 from fx_receipts r join"fx_receipt_items" on true where r.household_id = $1',
      [A],
    ],
    ['update"t" без own', 'update"fx_receipts" set note = $1', ["x"]],
    ['delete from"t" без own', 'delete from"fx_receipts"', []],
    [
      'insert into"t"(…) с чужим household_id',
      'insert into"fx_receipts"(household_id, user_id, merchant, total_minor) values ($1, $2, $3, 1)',
      [B, "u", "m"],
    ],
    [
      'with … merge into"t" с чужим household_id',
      'with x as (select 1) merge into"fx_receipts" t using x on false ' +
        "when not matched then insert (household_id, id) values ($1, $2)",
      [B, "x"],
    ],
    ['with … update"t" без own', 'with x as (select 1) update"fx_receipts" set note = $1', ["x"]],
    ['таблица вплотную после имени в кавычках: "r"from"t"', 'select 1 as"r"from"fx_receipts"', []],
  ])(
    "ключевое слово вплотную к кавычке (%s) → ISOLATION_VIOLATION в scoped и system",
    (_name, text, params) => {
      expect(violation(() => audit({ sql: text, params }))).toBeInstanceOf(IsolationViolation);
      expect(violation(() => audit({ sql: text, params }, system))).toBeInstanceOf(
        IsolationViolation,
      );
    },
  );

  it('select 1 as"from" — имя в кавычках, а не ключевое слово: проходит', () => {
    expect(() => audit({ sql: 'select 1 as"from"', params: [] })).not.toThrow();
    expect(() => audit({ sql: 'select 1 as"from"', params: [] }, system)).not.toThrow();
  });

  it("слово merge как имя колонки, а не команда, — проходит", () => {
    const text = "select merge from fx_receipts where household_id = $1";
    expect(() => audit({ sql: text, params: [A] })).not.toThrow();
  });

  it("построитель: with(cte).insert(t).values(чужой household_id) с setWhere own → INSERT_NOT_STANDALONE", () => {
    const query = db
      .with(mine)
      .insert(fxReceipts)
      .values({ householdId: B, userId: "u", merchant: "m", totalMinor: 1 })
      .onConflictDoUpdate({
        target: [fxReceipts.householdId, fxReceipts.id],
        set: { note: "x" },
        setWhere: own(fxReceipts),
      });
    expect(violation(() => audit(query)).reason).toBe("INSERT_NOT_STANDALONE");
  });

  it.each([
    [
      "UPDATE … RETURNING в CTE с own",
      "with x as (update fx_receipts set note = $1 where fx_receipts.household_id = $2 returning id) select id from x",
      ["n", A],
    ],
    [
      "DELETE … RETURNING в CTE с own",
      "with x as (delete from fx_receipts where fx_receipts.household_id = $1 returning id) select id from x",
      [A],
    ],
    [
      "SELECT … FOR UPDATE, $1::uuid и = ANY($2)",
      "select id from fx_receipts where fx_receipts.household_id = $1::uuid and id = any($2) for update",
      [A, ["x"]],
    ],
    [
      "операторы @> и ? над jsonb",
      "select id from fx_receipts where household_id = $1 and '{}'::jsonb @> '{}'::jsonb and '{}'::jsonb ? 'k'",
      [A],
    ],
    [
      'алиас в кавычках с заглавными (alias(t, "otherItems"))',
      'select "otherItems"."name" from "fx_receipt_items" "otherItems" where "otherItems"."household_id" = $1',
      [A],
    ],
  ])("правильная форма проходит: %s", (_name, text, params) => {
    expect(() => audit({ sql: text, params })).not.toThrow();
  });

  it.each([
    [
      "UPDATE … RETURNING в CTE без own",
      "with x as (update fx_receipts set note = $1 returning id) select id from x",
      ["n"],
    ],
    [
      "DELETE … RETURNING в CTE без own",
      "with x as (delete from fx_receipts returning id) select id from x",
      [],
    ],
  ])("модифицирующий CTE без own → MISSING_HOUSEHOLD_FILTER: %s", (_name, text, params) => {
    expect(violation(() => audit({ sql: text, params })).reason).toBe("MISSING_HOUSEHOLD_FILTER");
  });
});

describe("PRIV-07: SystemDb не касается пользовательских таблиц", () => {
  it.each([
    ["чтение", "select id from fx_receipts where household_id = $1"],
    ["вставка", "insert into fx_receipts (household_id) values ($1)"],
    ["JOIN к системной", "select * from fx_settings join fx_receipt_items on true"],
  ])("%s → SYSTEM_TOUCHES_USER_DATA", (_name, text) => {
    const error = violation(() => audit({ sql: text, params: [A] }, system));
    expect(error.reason).toBe("SYSTEM_TOUCHES_USER_DATA");
    expect(error.message).toMatch(/fx_receipt/);
  });

  it("системная и общая таблицы проходят", () => {
    expect(() => audit(db.select().from(fxSettings), system)).not.toThrow();
    expect(() =>
      audit(db.insert(fxRates).values({ code: "USD", rateMicros: 1 }), system),
    ).not.toThrow();
  });
});

describe("ARCHITECTURE §6.6: crossTenant только находит владельцев", () => {
  it("SELECT id, household_id, user_id проходит", () => {
    const query = db
      .select({ id: fxReceipts.id, householdId: fxReceipts.householdId, userId: fxReceipts.userId })
      .from(fxReceipts)
      .where(eq(fxReceipts.status, "recognizing"));
    expect(() => audit(query, crossTenant)).not.toThrow();
  });

  it.each([
    ["все колонки", db.select().from(fxReceipts)],
    ["сумма чека", db.select({ id: fxReceipts.id, total: fxReceipts.totalMinor }).from(fxReceipts)],
  ])("колонки шире (id, household_id, user_id): %s → CROSS_TENANT_COLUMNS", (_name, query) => {
    expect(violation(() => audit(query, crossTenant)).reason).toBe("CROSS_TENANT_COLUMNS");
  });

  it.each([
    ["UPDATE", "update fx_receipts set status = $1"],
    ["DELETE", "delete from fx_receipts"],
    ["INSERT", "insert into fx_settings (key, value) values ($1, $1)"],
    ["CTE с записью", "with x as (delete from fx_receipts returning id) select id from x"],
    ["блокировка строк", "select id from fx_receipts for update"],
  ])("%s → CROSS_TENANT_NOT_SELECT", (_name, text) => {
    expect(violation(() => audit({ sql: text, params: ["x"] }, crossTenant)).reason).toBe(
      "CROSS_TENANT_NOT_SELECT",
    );
  });
});

// Имя базы — из DATABASE_URL, секрета в нём нет: Postgres принимает <текущая_база>.public.t (в чужой — ошибка
// «cross-database references are not implemented»).
const CATALOG_FORMS = [
  (t: string) => `kosht.public.${t}`,
  (t: string) => `"kosht"."public"."${t}"`,
  (t: string) => `KOSHT . PUBLIC . "${t}"`,
  (t: string) => `test_1/**/./**/"public"/**/./**/${t}`,
];

describe("ROLE-01, SEC-04: имя с каталогом базы (<база>.public.t) — то же обращение", () => {
  const leaks: [string, (t: (name: string) => string) => string, unknown[]][] = [
    ["select", (t) => `select note from ${t("fx_receipts")}`, []],
    [
      "JOIN",
      (t) =>
        `select 1 from fx_receipts r join ${t("fx_receipt_items")} i on true where r.household_id = $1`,
      [A],
    ],
    [
      "подзапрос",
      (t) => `select (select string_agg(note, ',') from ${t("fx_receipts")}) as c from fx_rates`,
      [],
    ],
    ["update", (t) => `update ${t("fx_receipts")} set note = $1`, ["x"]],
    ["delete", (t) => `delete from ${t("fx_transactions")}`, []],
    [
      "insert с чужим household_id",
      (t) =>
        `insert into ${t("fx_receipts")} (household_id, user_id, merchant, total_minor) values ($1, $2, 'm', 1)`,
      [B, "u"],
    ],
    [
      "WITH … insert",
      (t) =>
        `with x as (select 1) insert into ${t("fx_receipts")} (household_id, user_id, merchant, total_minor) ` +
        "values ($1, $2, 'm', 1)",
      [A, "u"],
    ],
  ];
  for (const [index, form] of CATALOG_FORMS.entries()) {
    it.each(leaks)(
      `форма ${index + 1} (${form("t")}): %s → ISOLATION_VIOLATION в scoped и system`,
      (_n, q, params) => {
        const text = q(form);
        expect(violation(() => audit({ sql: text, params }))).toBeInstanceOf(IsolationViolation);
        expect(violation(() => audit({ sql: text, params }, system))).toBeInstanceOf(
          IsolationViolation,
        );
      },
    );

    it(`форма ${index + 1}: чтение и вставка со своим own проходят`, () => {
      const t = form("fx_receipts");
      expect(() =>
        audit({ sql: `select note from ${t} where household_id = $1`, params: [A] }),
      ).not.toThrow();
      expect(() =>
        audit({
          sql: `insert into ${t} (household_id, user_id, merchant, total_minor) values ($1, $2, 'm', 1)`,
          params: [A, "u"],
        }),
      ).not.toThrow();
    });
  }
});

describe("ROLE-01, SEC-04: слово from внутри выражения не обрывает список SET", () => {
  it.each<[string, string, unknown[]]>([
    [
      "UPDATE: is distinct from перед household_id = $2",
      "update fx_receipts set note = 1 is distinct from 2, household_id = $2 where household_id = $1",
      [A, B],
    ],
    [
      "UPDATE: is not distinct from перед household_id = $2",
      "update fx_receipts set note = 1 is not distinct from 2, household_id = $2 where household_id = $1",
      [A, B],
    ],
    [
      "ON CONFLICT DO UPDATE: is distinct from перед household_id = $3",
      "insert into fx_receipts (household_id, user_id, merchant, total_minor) values ($1, $2, 'm', 1) " +
        "on conflict (household_id, id) do update set note = 1 is distinct from 2, household_id = $3",
      [A, "u", B],
    ],
    [
      "кортежный SET после is distinct from",
      "update fx_receipts set note = 1 is distinct from 2, (household_id) = row($2) where household_id = $1",
      [A, B],
    ],
  ])("%s → OWNER_CHANGE", (_name, text, params) => {
    expect(violation(() => audit({ sql: text, params })).reason).toBe("OWNER_CHANGE");
  });

  it.each<[string, string, unknown[]]>([
    [
      "UPDATE … FROM с own у обеих таблиц",
      "update fx_receipts set note = i.name from fx_receipt_items i " +
        "where fx_receipts.household_id = $1 and i.household_id = $1",
      [A],
    ],
    [
      "extract, substring, trim, overlay, position и is distinct from в SET и WHERE",
      "update fx_receipts set note = extract(year from now())::text, " +
        "status = substring('abc' from 1 for 2) || trim(both from ' x ') || overlay('abc' placing 'z' from 2), " +
        "total_minor = position('a' in 'abc'), merchant = (1 is distinct from 2)::text " +
        "where household_id = $1 and note is not distinct from null returning id, household_id",
      [A],
    ],
    [
      "UPSERT: SET без household_id, WHERE с from внутри выражения",
      "insert into fx_receipts (household_id, user_id, merchant, total_minor) values ($1, $2, 'm', 1) " +
        "on conflict (household_id, id) do update set note = 1 is distinct from 2 " +
        "where fx_receipts.household_id = $1 returning household_id",
      [A, "u"],
    ],
  ])("правильная форма проходит: %s", (_name, text, params) => {
    expect(() => audit({ sql: text, params })).not.toThrow();
  });
});

describe("ROLE-01, SEC-04: ключевое слово после имени таблицы — алиас ровно тогда, когда так решает Postgres", () => {
  it.each<[string, string]>([
    [
      'tablesample — не алиас: "tablesample" второй таблицы не фильтрует первую',
      'select * from fx_receipts tablesample system (100), fx_receipt_items "tablesample" ' +
        'where "tablesample".household_id = $1 and "tablesample".household_id = $1',
    ],
    [
      "values — алиас: fx_receipts.household_id фильтрует только второе обращение",
      "select * from fx_receipts values, fx_receipts " +
        "where fx_receipts.household_id = $1 and fx_receipts.household_id = $1",
    ],
    [
      "set в FROM — алиас",
      "select * from fx_receipts set, fx_receipts " +
        "where fx_receipts.household_id = $1 and fx_receipts.household_id = $1",
    ],
    [
      "overriding — алиас",
      "select * from fx_receipts as overriding, fx_receipts " +
        "where fx_receipts.household_id = $1 and fx_receipts.household_id = $1",
    ],
  ])("%s → MISSING_HOUSEHOLD_FILTER", (_name, text) => {
    const error = violation(() => audit({ sql: text, params: [A] }));
    expect(error.reason).toBe("MISSING_HOUSEHOLD_FILTER");
    expect(error.table).toBe("fx_receipts");
  });

  it("алиас values с own проходит, UPDATE … SET — не алиас", () => {
    const read = "select values.note from fx_receipts values where values.household_id = $1";
    expect(() => audit({ sql: read, params: [A] })).not.toThrow();
    const update = "update fx_receipts set note = $1 where fx_receipts.household_id = $2";
    expect(() => audit({ sql: update, params: ["x", A] })).not.toThrow();
  });
});

describe("ROLE-01, SEC-04: имена с $ и не-ASCII буквами — целые имена, как в Postgres", () => {
  it.each<[string, string]>([
    [
      "алиас кириллицей: два предиката «чек.» не фильтруют «где»",
      "select * from fx_receipts чек, fx_receipts где where чек.household_id = $1 and чек.household_id = $1",
    ],
    [
      "алиас a$b — не алиас a",
      "select * from fx_receipts a$b, fx_receipts a where a.household_id = $1 and a.household_id = $1",
    ],
    [
      "(a).household_id — поле записи, а не предикат без квалификатора",
      "select * from fx_receipts a, fx_receipts b where (a).household_id = $1 and (a).household_id = $1",
    ],
  ])("%s → MISSING_HOUSEHOLD_FILTER", (_name, text) => {
    expect(violation(() => audit({ sql: text, params: [A] })).reason).toBe(
      "MISSING_HOUSEHOLD_FILTER",
    );
  });

  it.each<[string, string]>([
    ["алиас кириллицей", "select чек.note from fx_receipts чек where чек.household_id = $1"],
    [
      "алиас в кавычках и без — одно имя",
      'select "чек".note from fx_receipts чек where "чек".household_id = $1',
    ],
    ["алиас с $", "select a$b.note from fx_receipts a$b where a$b.household_id = $1"],
  ])("правильная форма проходит: %s", (_name, text) => {
    expect(() => audit({ sql: text, params: [A] })).not.toThrow();
  });
});

describe("ROLE-01, SEC-04: за VALUES у INSERT — только ON CONFLICT и RETURNING", () => {
  it.each<[string, string]>([
    [
      "VALUES … UNION ALL SELECT с чужим household_id",
      "insert into fx_receipts (household_id, user_id, merchant, total_minor) values ($1, $2, 'm', 1) " +
        "union all select $3::uuid, $2, 'm', 1",
    ],
    [
      "VALUES … EXCEPT SELECT",
      "insert into fx_receipts (household_id, user_id, merchant, total_minor) values ($1, $2, 'm', 1) " +
        "except select $3::uuid, $2, 'm', 1",
    ],
  ])("%s → INSERT_SELECT", (_name, text) => {
    expect(violation(() => audit({ sql: text, params: [A, "u", B] })).reason).toBe("INSERT_SELECT");
  });
});

describe("ARCHITECTURE §6.6: crossTenant — один SELECT без UNION", () => {
  it.each([
    "select id, household_id, user_id from fx_receipts union all select household_id, user_id, md5(note)::uuid from fx_receipts",
    "select id, household_id, user_id from fx_receipts intersect select id, household_id, user_id from fx_receipts",
  ])("%s → CROSS_TENANT_NOT_SELECT", (text) => {
    expect(violation(() => audit({ sql: text, params: [] }, crossTenant)).reason).toBe(
      "CROSS_TENANT_NOT_SELECT",
    );
  });

  it.each([
    "select id, household_id, user_id from fx_receipts where note is distinct from 'x'",
    "select distinct id, household_id, user_id from fx_receipts where extract(year from created_at) > 2000",
  ])("правильная форма проходит: %s", (text) => {
    expect(() => audit({ sql: text, params: [] }, crossTenant)).not.toThrow();
  });
});

describe("ROLE-01, SEC-04: ключевые слова внутри выражений не ломают разбор", () => {
  it.each<[string, string]>([
    [
      "filter (where …), within group (order by …), over (partition by …)",
      "select count(*) filter (where status = 'x'), " +
        "percentile_cont(0.5) within group (order by total_minor), " +
        "sum(total_minor) over (partition by status) from fx_receipts where household_id = $1 group by status, total_minor",
    ],
    [
      "at time zone, = any(…), array(select … с own), distinct on (…), fetch first",
      "select distinct on (status) created_at at time zone 'UTC', " +
        "array(select i.name from fx_receipt_items i where i.household_id = $1) from fx_receipts r " +
        "where r.household_id = $1 and r.status = any($2) order by status fetch first 1 rows only",
    ],
    [
      "lateral с own внутри",
      "select r.note, l.name from fx_receipts r, lateral (select i.name from fx_receipt_items i " +
        "where i.household_id = $1 and i.receipt_id = r.id) l where r.household_id = $1",
    ],
  ])("правильная форма проходит: %s", (_name, text) => {
    expect(() => audit({ sql: text, params: [A, ["x"]] })).not.toThrow();
  });

  it.each<[string, string]>([
    [
      "array(select …) без own",
      "select array(select i.name from fx_receipt_items i) from fx_receipts r where r.household_id = $1",
    ],
    [
      "lateral без own внутри",
      "select l.name from fx_receipts r, lateral (select i.name from fx_receipt_items i " +
        "where i.receipt_id = r.id) l where r.household_id = $1",
    ],
  ])("%s → ISOLATION_VIOLATION", (_name, text) => {
    expect(violation(() => audit({ sql: text, params: [A] }))).toBeInstanceOf(IsolationViolation);
  });
});
