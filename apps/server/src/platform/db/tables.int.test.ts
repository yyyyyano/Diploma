// Виды таблиц на настоящей базе (ARCHITECTURE §15): имена колонок drizzle-kit и запросов совпадают, составной FK
// не даёт сослаться на чужую строку, ON DELETE SET NULL (receipt_id) не трогает household_id.
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateFixtures } from "./__fixtures__/fixture-db.ts";
import { fxReceiptItems, fxReceipts, fxTransactions } from "./__fixtures__/schema.ts";
import { createScopedDb } from "./scoped-db.ts";
import { createUnsafeRaw } from "./unsafe-raw.ts";

const scopeA = testScope({ user: 1, household: 1 });
const scopeB = testScope({ user: 2, household: 2 });

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await migrateFixtures(db.owner);
});
afterAll(async () => {
  await db.drop();
});

describe("ARCHITECTURE §15: casing drizzle-kit и запросов один", () => {
  it("колонки в базе — snake_case, как в запросах Drizzle", async () => {
    const { rows } = await db.pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'fx_receipts' order by ordinal_position",
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      "id",
      "household_id",
      "user_id",
      "created_at",
      "updated_at",
      "merchant",
      "total_minor",
      "status",
      "note",
    ]);
  });

  it("строка записывается и читается через ScopedDb; id — uuidv7() базы, household_id и user_id — из scope", async () => {
    const s = createScopedDb(db.pool, scopeA);
    const [created] = await s
      .insert(fxReceipts)
      .values({ merchant: "Евроопт", totalMinor: 847 })
      .returning();
    const [read] = await s.db.select().from(fxReceipts).where(s.own(fxReceipts));
    expect(read).toEqual(created);
    expect(read).toMatchObject({
      householdId: scopeA.householdId,
      userId: scopeA.userId,
      totalMinor: 847,
    });
    expect(read?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it("update ставит updated_at базы и не трогает created_at", async () => {
    const s = createScopedDb(db.pool, scopeA);
    const [row] = await s.insert(fxReceipts).values({ merchant: "m", totalMinor: 1 }).returning();
    const [updated] = await s
      .update(fxReceipts, eq(fxReceipts.id, row?.id ?? ""))
      .set({ status: "ok" })
      .returning();
    expect(updated?.createdAt).toEqual(row?.createdAt);
    expect(updated?.status).toBe("ok");
  });
});

describe("ROLE-01: составной FK — замок 2", () => {
  it("позиция чека домохозяйства A не может сослаться на чек B: foreign_key_violation", async () => {
    const [receiptB] = await createScopedDb(db.pool, scopeB)
      .insert(fxReceipts)
      .values({ merchant: "B", totalMinor: 1 })
      .returning();
    const a = createScopedDb(db.pool, scopeA);
    await expect(
      a.insert(fxReceiptItems).values({ receiptId: receiptB?.id ?? "", name: "хлеб", sumMinor: 1 }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
  });

  it("UPSERT по одному id база отвергает: уникальности по id нет (42P10)", async () => {
    const raw = createUnsafeRaw(db.pool);
    await expect(
      raw.execute(
        "insert into fx_receipts (household_id, user_id, merchant, total_minor) values (gen_random_uuid(), gen_random_uuid(), 'm', 1) on conflict (id) do nothing",
      ),
    ).rejects.toMatchObject({ cause: { code: "42P10" } });
  });

  it("ON DELETE SET NULL (receipt_id): удаление чека обнуляет ссылку, household_id операции прежний", async () => {
    const s = createScopedDb(db.pool, scopeA);
    const [receipt] = await s
      .insert(fxReceipts)
      .values({ merchant: "m", totalMinor: 5 })
      .returning();
    const [txn] = await s
      .insert(fxTransactions)
      .values({ description: "покупка", amountMinor: -5, receiptId: receipt?.id ?? null })
      .returning();
    await s.delete(fxReceipts, eq(fxReceipts.id, receipt?.id ?? ""));
    const [after] = await s.db
      .select()
      .from(fxTransactions)
      .where(and(s.own(fxTransactions), eq(fxTransactions.id, txn?.id ?? "")));
    expect(after).toMatchObject({ receiptId: null, householdId: scopeA.householdId });
  });
});
