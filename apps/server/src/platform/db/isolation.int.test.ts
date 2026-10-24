// Канарейки изоляции на настоящей базе (ADR-0006, ARCHITECTURE §6.2 замки 3 и 5): данные двух домохозяйств,
// у строк B — метка CANARY-B. Дырявый запрос от A останавливается ДО базы (счётчик запросов пула не растёт),
// данные B побайтно те же (хеш до и после); та же дыра без аудитора действительно читает или портит B —
// значит, канарейка проверяет настоящую ошибку, а не выдуманную.
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { and, eq, inArray, sql, sum, TransactionRollbackError } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateFixtures } from "./__fixtures__/fixture-db.ts";
import { fxReceiptItems, fxReceipts, fxSettings, fxTransactions } from "./__fixtures__/schema.ts";
import { IsolationViolation } from "./audit.ts";
import { crossTenant } from "./cross-tenant.ts";
import { createScopedDb, type ScopedDb } from "./scoped-db.ts";
import { createSystemDb } from "./system-db.ts";
import { createUnsafeRaw } from "./unsafe-raw.ts";

const scopeA = testScope({ user: 1, household: 1 });
const scopeB = testScope({ user: 2, household: 2 });

let db: TestDb;
let receiptA: string;
let receiptB: string;

/** Пул, считающий запросы, ушедшие в базу мимо транзакций (транзакции берут соединение через connect). */
function countingPool(pool: pg.Pool): { pool: pg.Pool; sent: () => number } {
  let sent = 0;
  const counting = Object.create(pool) as pg.Pool;
  counting.query = ((...args: unknown[]) => {
    sent += 1;
    return (pool.query as (...a: unknown[]) => unknown).apply(pool, args);
  }) as pg.Pool["query"];
  return { pool: counting, sent: () => sent };
}

/** Отпечаток всех строк B во всех пользовательских таблицах тестовой схемы. */
async function hashOfB(): Promise<string> {
  const { rows } = await db.pool.query<{ hash: string }>(
    `select md5(string_agg(r, '|' order by r)) as hash from (
       select t::text as r from fx_receipts t where household_id = $1
       union all select t::text from fx_receipt_items t where household_id = $1
       union all select t::text from fx_transactions t where household_id = $1) x`,
    [scopeB.householdId],
  );
  return rows[0]?.hash ?? "";
}

beforeAll(async () => {
  db = await createTestDb();
  await migrateFixtures(db.pool);
  for (const [scope, label] of [
    [scopeA, "A"],
    [scopeB, "CANARY-B"],
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
    if (scope === scopeA) receiptA = id;
    else receiptB = id;
  }
  await createSystemDb(db.pool).insert(fxSettings).values({ key: "k", value: "v" });
});
afterAll(async () => {
  await db.drop();
});

let bBefore: string;
beforeEach(async () => {
  bBefore = await hashOfB();
});

type Leak = (s: ScopedDb) => Promise<unknown>;

const LEAKS: [string, Leak][] = [
  [
    "забытый where: чек по id",
    (s) => s.db.select().from(fxReceipts).where(eq(fxReceipts.id, receiptB)),
  ],
  [
    "второй where в $dynamic() затёр own",
    (s) =>
      s.db
        .select()
        .from(fxReceipts)
        .where(s.own(fxReceipts))
        .$dynamic()
        .where(eq(fxReceipts.id, receiptB)),
  ],
  [
    "JOIN без own у второй таблицы",
    (s) =>
      s.db
        .select({ name: fxReceiptItems.name })
        .from(fxReceipts)
        .innerJoin(fxReceiptItems, eq(fxReceiptItems.name, fxReceiptItems.name))
        .where(s.own(fxReceipts)),
  ],
  [
    "подзапрос без own",
    (s) =>
      s.db
        .select()
        .from(fxTransactions)
        .where(
          and(
            s.own(fxTransactions),
            inArray(fxTransactions.receiptId, s.db.select({ id: fxReceipts.id }).from(fxReceipts)),
          ),
        ),
  ],
  [
    "CTE без own",
    (s) => {
      const all = s.db.$with("all_receipts").as(s.db.select().from(fxReceipts));
      return s.db.with(all).select().from(all);
    },
  ],
  ["агрегат по всем", (s) => s.db.select({ total: sum(fxReceipts.totalMinor) }).from(fxReceipts)],
  ["сырой sql без фильтра", (s) => s.db.execute(sql`select note from ${fxReceipts}`)],
  [
    "UPDATE по id без own",
    (s) => s.db.update(fxReceipts).set({ note: "взлом" }).where(eq(fxReceipts.id, receiptB)),
  ],
  [
    "DELETE по id без own",
    (s) => s.db.delete(fxTransactions).where(eq(fxTransactions.receiptId, receiptB)),
  ],
  [
    "INSERT с чужим household_id",
    (s) =>
      s.db.insert(fxReceipts).values({
        householdId: scopeB.householdId,
        userId: scopeA.userId,
        merchant: "подброс",
        totalMinor: 1,
      }),
  ],
  [
    "кортежный SET переносит строку A в B",
    (s) =>
      s.db.execute(
        sql`update ${fxReceipts} set (household_id, note) = (${scopeB.householdId}, 'подброс') where ${s.own(fxReceipts)}`,
      ),
  ],
  [
    "литералы '/*' и '*/' прячут подзапрос без own",
    (s) =>
      s.db.execute(
        sql`select '/*', (select string_agg(note, ',') from fx_receipts), '*/' as c from ${fxReceipts} where ${s.own(fxReceipts)}`,
      ),
  ],
  [
    "DO-блок с UPDATE внутри $$…$$",
    (s) => s.db.execute(sql.raw("do $$ begin update fx_receipts set note = 'взлом'; end $$")),
  ],
  [
    "query_to_xml читает таблицу из строки",
    (s) => s.db.execute(sql`select query_to_xml('select note from fx_receipts', true, false, '')`),
  ],
  [
    "вторая команда через «;»",
    (s) => s.db.execute(sql.raw("select 1; update fx_receipts set note = 'взлом'")),
  ],
  [
    "«--…\\r» прячет таблицу от аудитора",
    (s) => s.db.execute(sql.raw("select note -- x\rfrom fx_receipts")),
  ],
  [
    "«--\\r» прячет вторую команду",
    (s) => s.db.execute(sql.raw("select 1 --\r; update fx_receipts set note = 'взлом'")),
  ],
  [
    "продолжение E-строки прячет подзапрос",
    (s) =>
      s.db.execute(
        sql.raw(
          "select E'x'\n'\\' , (select 1) ', (select string_agg(note, ',') from fx_receipts), '' as c",
        ),
      ),
  ],
  [
    "алиас «A» в кавычках и a без кавычек — один own на двоих",
    (s) =>
      s.db.execute(
        sql`select "A".note from fx_receipts "A", fx_receipts a where a.household_id = ${s.scope.householdId} and a.household_id = ${s.scope.householdId}`,
      ),
  ],
  [
    "WITH … INSERT с чужим household_id и setWhere own (построитель)",
    (s) => {
      const mine = s.db.$with("mine").as(s.db.select().from(fxReceipts).where(s.own(fxReceipts)));
      return s.db
        .with(mine)
        .insert(fxReceipts)
        .values({
          householdId: scopeB.householdId,
          userId: scopeA.userId,
          merchant: "подброс",
          totalMinor: 1,
        })
        .onConflictDoUpdate({
          target: [fxReceipts.householdId, fxReceipts.id],
          set: { note: "взлом" },
          setWhere: s.own(fxReceipts),
        });
    },
  ],
  [
    "INSERT с чужим household_id внутри CTE",
    (s) =>
      s.db.execute(
        sql`with x as (insert into fx_receipts (household_id, user_id, merchant, total_minor) values (${scopeB.householdId}, ${scopeA.userId}, 'подброс', 1) returning id) select id from ${fxReceipts} where ${s.own(fxReceipts)} and ${s.own(fxReceipts)}`,
      ),
  ],
  [
    "WITH … MERGE … WHEN NOT MATCHED THEN INSERT с чужим household_id",
    (s) =>
      s.db.execute(
        sql`with x as (select 1) merge into ${fxReceipts} t using x on t.household_id = ${s.scope.householdId} and t.id is null when not matched then insert (household_id, user_id, merchant, total_minor) values (${scopeB.householdId}, ${scopeA.userId}, 'подброс', 1)`,
      ),
  ],
  [
    'from"fx_receipts" — ключевое слово вплотную к кавычке',
    (s) => s.db.execute(sql.raw('select note from"fx_receipts"')),
  ],
  [
    'WITH … merge into"fx_receipts" с чужим household_id',
    (s) =>
      s.db.execute(
        sql`with x as (select 1) merge into"fx_receipts" t using x on false when not matched then insert (household_id, user_id, merchant, total_minor) values (${scopeB.householdId}, ${scopeA.userId}, 'подброс', 1)`,
      ),
  ],
  [
    "<база>.public.fx_receipts — имя с каталогом текущей базы",
    (s) => s.db.execute(sql.raw(`select note from ${db.name}.public.fx_receipts`)),
  ],
  [
    '"<база>"."public"."fx_receipts" — INSERT с чужим household_id',
    (s) =>
      s.db.execute(
        sql`insert into ${sql.raw(`"${db.name}"."public"."fx_receipts"`)} (household_id, user_id, merchant, total_minor) values (${scopeB.householdId}, ${scopeA.userId}, 'подброс', 1)`,
      ),
  ],
  [
    "is distinct from в SET прячет household_id = B",
    (s) =>
      s.db.execute(
        sql`update ${fxReceipts} set note = 1 is distinct from 2, household_id = ${scopeB.householdId} where ${s.own(fxReceipts)}`,
      ),
  ],
  [
    "is not distinct from в ON CONFLICT DO UPDATE SET прячет household_id = B",
    (s) =>
      s.db.execute(
        sql`insert into ${fxReceipts} (household_id, id, user_id, merchant, total_minor) values (${s.scope.householdId}, ${receiptA}, ${scopeA.userId}, 'm', 1) on conflict (household_id, id) do update set note = 1 is not distinct from 2, household_id = ${scopeB.householdId}`,
      ),
  ],
  [
    'tablesample — не алиас: предикаты "tablesample" фильтруют другую таблицу',
    (s) =>
      s.db.execute(
        sql`select fx_receipts.note from ${fxReceipts} tablesample system (100), fx_receipt_items "tablesample" where "tablesample".household_id = ${s.scope.householdId} and "tablesample".household_id = ${s.scope.householdId}`,
      ),
  ],
  [
    "values — алиас: fx_receipts.household_id фильтрует только второе обращение",
    (s) =>
      s.db.execute(
        sql`select values.note from fx_receipts values, fx_receipts where fx_receipts.household_id = ${s.scope.householdId} and fx_receipts.household_id = ${s.scope.householdId}`,
      ),
  ],
  [
    "алиас кириллицей: оба предиката у «чек», «где» без фильтра",
    (s) =>
      s.db.execute(
        sql`select где.note from fx_receipts чек, fx_receipts где where чек.household_id = ${s.scope.householdId} and чек.household_id = ${s.scope.householdId}`,
      ),
  ],
  [
    "(a).household_id дважды — b без фильтра",
    (s) =>
      s.db.execute(
        sql`select b.note from fx_receipts a, fx_receipts b where (a).household_id = ${s.scope.householdId} and (a).household_id = ${s.scope.householdId}`,
      ),
  ],
];

describe("ROLE-01, SEC-04: дырявый запрос не доходит до базы, данные B не меняются", () => {
  it.each(LEAKS)("%s → ISOLATION_VIOLATION", async (_name, leak) => {
    const counting = countingPool(db.pool);
    await expect(leak(createScopedDb(counting.pool, scopeA))).rejects.toBeInstanceOf(
      IsolationViolation,
    );
    expect(counting.sent()).toBe(0);
    expect(await hashOfB()).toBe(bBefore);
  });

  it("счётчик пула видит запросы: правильный запрос дошёл до базы один раз", async () => {
    const counting = countingPool(db.pool);
    const s = createScopedDb(counting.pool, scopeA);
    await s.db.select().from(fxReceipts).where(s.own(fxReceipts));
    expect(counting.sent()).toBe(1);
  });

  it("канарейка механизма: та же дыра на drizzle() без аудитора читает чек B", async () => {
    const bare = drizzle({ client: db.pool });
    const rows = await bare.select().from(fxReceipts).where(eq(fxReceipts.id, receiptB));
    expect(rows.map((r) => r.note)).toEqual(["CANARY-B"]);
  });

  it("канарейка механизма: UPDATE по id без аудитора портит строку B", async () => {
    // Порча делается в транзакции и откатывается: соседние канарейки видят B нетронутым.
    let noteInside: string | null | undefined;
    const rolledBack = createUnsafeRaw(db.pool).transaction(async (tx) => {
      await tx.update(fxReceipts).set({ note: "взлом" }).where(eq(fxReceipts.id, receiptB));
      const [row] = await tx
        .select({ note: fxReceipts.note })
        .from(fxReceipts)
        .where(eq(fxReceipts.id, receiptB));
      noteInside = row?.note;
      tx.rollback();
    });
    await expect(rolledBack).rejects.toBeInstanceOf(TransactionRollbackError);
    expect(noteInside).toBe("взлом");
    expect(await hashOfB()).toBe(bBefore);
  });

  it("SystemDb не читает пользовательскую таблицу — до базы не дошло", async () => {
    const counting = countingPool(db.pool);
    await expect(createSystemDb(counting.pool).select().from(fxReceipts)).rejects.toMatchObject({
      reason: "SYSTEM_TOUCHES_USER_DATA",
    });
    expect(counting.sent()).toBe(0);
  });

  it("crossTenant с колонками шире (id, household_id, user_id) — до базы не дошло", async () => {
    const counting = countingPool(db.pool);
    await expect(
      crossTenant(
        counting.pool,
        "fx.leak",
        (q) => q.select({ id: fxReceipts.id, note: fxReceipts.note }).from(fxReceipts) as never,
      ),
    ).rejects.toMatchObject({ reason: "CROSS_TENANT_COLUMNS" });
    expect(counting.sent()).toBe(0);
  });
});

describe("ROLE-01: правильные формы на настоящей базе", () => {
  it("JOIN с own у каждой таблицы видит только своё", async () => {
    const s = createScopedDb(db.pool, scopeA);
    const rows = await s.db
      .select({ merchant: fxReceipts.merchant, item: fxReceiptItems.name })
      .from(fxReceipts)
      .innerJoin(
        fxReceiptItems,
        and(s.own(fxReceiptItems), eq(fxReceiptItems.receiptId, fxReceipts.id)),
      )
      .where(s.own(fxReceipts));
    expect(rows).toEqual([{ merchant: "A магазин", item: "A хлеб" }]);
  });

  it("чужой id через s.update и s.delete — 0 строк, B не изменено", async () => {
    const s = createScopedDb(db.pool, scopeA);
    const updated = await s
      .update(fxReceipts, eq(fxReceipts.id, receiptB))
      .set({ note: "взлом" })
      .returning();
    const deleted = await s
      .delete(fxTransactions, eq(fxTransactions.receiptId, receiptB))
      .returning();
    expect([updated, deleted]).toEqual([[], []]);
    expect(await hashOfB()).toBe(bBefore);
  });

  it("вложенная транзакция: откат SAVEPOINT, внешняя продолжается и фиксируется", async () => {
    const s = createScopedDb(db.pool, scopeA);
    await s.transaction(async (tx) => {
      await tx.update(fxReceipts, eq(fxReceipts.id, receiptA)).set({ note: "внешняя" });
      await expect(
        tx.transaction(async (inner) => {
          await inner.update(fxReceipts, eq(fxReceipts.id, receiptA)).set({ note: "вложенная" });
          await inner.db.select().from(fxReceipts);
        }),
      ).rejects.toBeInstanceOf(IsolationViolation);
    });
    const [row] = await s.db
      .select({ note: fxReceipts.note })
      .from(fxReceipts)
      .where(and(s.own(fxReceipts), eq(fxReceipts.id, receiptA)));
    expect(row?.note).toBe("внешняя");
  });

  it("crossTenant находит владельцев обоих домохозяйств — только id, household_id, user_id", async () => {
    const rows = await crossTenant(db.pool, "fx.all", (q) =>
      q
        .select({
          id: fxReceipts.id,
          householdId: fxReceipts.householdId,
          userId: fxReceipts.userId,
        })
        .from(fxReceipts),
    );
    expect(rows.map((r) => r.householdId).toSorted()).toEqual(
      [scopeA.householdId, scopeB.householdId].toSorted(),
    );
  });
});
