// Репозиторий transactions на Postgres: пустой список id — пустой ответ без запроса; чужие id не возвращаются и не
// блокируются; история операции и пачка — по порядку времени.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  newScope,
  transactionsWithJournal,
} from "../../../../main/__fixtures__/transactions-with-journal.ts";
import {
  deleteTransactions,
  existingIds,
  findMany,
  insertRevisions,
  insertTransaction,
  listBatch,
  listRevisions,
  lockMany,
} from "./transactions.repo.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

async function seeded() {
  const s = newScope(db);
  const t = transactionsWithJournal(db);
  const cash = await s.transaction((tx) => t.accounts.cash(tx));
  const row = await insertTransaction(s, {
    accountId: cash,
    type: "expense",
    direction: "out",
    occurredOn: "2026-10-20",
    amountMinor: 100,
    currency: "BYN",
    amountBynMinor: 100,
    categoryCode: "other",
    categorySource: "user",
    source: "manual",
  });
  return { s, cash, row };
}

describe("TXN-02: выборки по списку id", () => {
  it("пустой список id — пусто, и ничего не удаляется", async () => {
    const { s, row } = await seeded();
    expect(await findMany(s, [])).toEqual([]);
    expect(await lockMany(s, [])).toEqual([]);
    expect(await existingIds(s, [])).toEqual(new Set());
    await deleteTransactions(s, []);
    expect(await findMany(s, [row.id])).toHaveLength(1);
  });

  it("чужие id не находятся, не блокируются и не удаляются", async () => {
    const mine = await seeded();
    const other = newScope(db);
    expect(await findMany(other, [mine.row.id])).toEqual([]);
    expect(await lockMany(other, [mine.row.id])).toEqual([]);
    expect(await existingIds(other, [mine.row.id])).toEqual(new Set());
    await deleteTransactions(other, [mine.row.id]);
    expect([...(await existingIds(mine.s, [mine.row.id]))]).toEqual([mine.row.id]);
  });
});

describe("TXN-05: ревизии", () => {
  it("пустая пачка ревизий — ничего не пишет; история и пачка читаются по порядку", async () => {
    const { s, row } = await seeded();
    await insertRevisions(s, []);
    const batchId = "0199c1a0-0000-7000-8000-0000000000b1";
    await insertRevisions(s, [
      { transactionId: row.id, batchId, action: "created", channel: "web", versionAfter: 1 },
      { transactionId: row.id, batchId, action: "updated", channel: "web", versionAfter: 2 },
    ]);
    expect((await listRevisions(s, row.id)).map((r) => r.action)).toEqual(["created", "updated"]);
    expect((await listBatch(s, batchId)).map((r) => r.versionAfter)).toEqual([1, 2]);
  });
});
