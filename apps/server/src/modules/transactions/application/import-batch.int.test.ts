// STMT-03, STMT-07, STMT-08, STMT-11, TXN-05 на Postgres: запись выписки одной пачкой — операции, пары переводов,
// «Наличные» для снятия, связь возврата с покупкой, остатки счетов, одно событие на весь импорт; откат импорта.
import { TransactionId } from "@kosht/contract";
import { LocalDate, Money } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  entry,
  newScope,
  transactionsWithJournal,
  WEB,
} from "../../../main/__fixtures__/transactions-with-journal.ts";
import { countEditedInImport } from "../infrastructure/db/transactions.repo.ts";
import type { ImportRow } from "./import-batch.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

async function setup() {
  const s = newScope(db);
  const t = transactionsWithJournal(db);
  const card = await s.transaction((tx) =>
    t.accounts.findOrCreate(tx, { bank: "Лесбанк", mask: "4821", currency: "BYN" }),
  );
  const cash = await s.transaction((tx) => t.accounts.cash(tx));
  const balance = async (id: string) =>
    (await t.accounts.list(s)).items.find((item) => item.id === id)?.balance.minor;
  const row = (over: Partial<ImportRow> & { key: string }): ImportRow => ({
    accountId: card,
    type: "expense",
    direction: "out",
    occurredOn: "2026-09-10",
    amount: Money.of(1_000, "BYN"),
    amountBynMinor: 1_000,
    fxRateId: null,
    description: "EVROTORG",
    merchantName: "Евроопт",
    merchantKey: "EVROTORG",
    category: { code: "groceries", source: "merchant" },
    dedupeKey: over.key,
    ...over,
  });
  return { s, t, card, cash, balance, row };
}

describe("STMT-03, TXN-05: запись выписки", () => {
  it("300 операций — одно transactions.changed со всеми id, остаток счёта сдвинут на сумму, источник «выписка»", async () => {
    const { s, t, card, balance, row } = await setup();
    const importId = randomUUID();
    const rows = Array.from({ length: 300 }, (_, i) =>
      row({ key: `k${i}`, amount: Money.of(100 + i, "BYN") }),
    );
    const result = await s.transaction((tx) => t.imports.importBatch(tx, { importId, rows }));
    expect(result.ids).toHaveLength(300);
    const changed = t.published.filter((event) => event.name === "transactions.changed");
    expect(changed).toHaveLength(1);
    expect(new Set(changed[0]?.ids)).toEqual(new Set(result.ids));
    const expected = rows.reduce((acc, r) => acc + r.amount.minor, 0);
    expect(await balance(card)).toBe(-expected);
    const sample = await db.owner.query<{ source: string; import_id: string; dedupe_key: string }>(
      "select source, import_id, dedupe_key from transactions where household_id = $1 limit 1",
      [s.scope.householdId],
    );
    expect(sample.rows[0]).toMatchObject({ source: "statement", import_id: importId });
  });

  it("STMT-08: снятие наличных — перевод с парной операцией на «Наличные»; остаток наличных растёт, расходов нет", async () => {
    const { s, t, card, cash, balance, row } = await setup();
    const result = await s.transaction((tx) =>
      t.imports.importBatch(tx, {
        importId: randomUUID(),
        rows: [
          row({
            key: "atm",
            type: "transfer",
            direction: "out",
            amount: Money.of(20_000, "BYN"),
            amountBynMinor: 20_000,
            description: "Снятие наличных",
            merchantName: null,
            merchantKey: null,
            category: null,
            cashCounterpart: true,
          }),
        ],
      }),
    );
    expect(result.cashCounterparts).toBe(1);
    expect(await balance(card)).toBe(-20_000);
    expect(await balance(cash)).toBe(20_000);
    const { rows } = await db.owner.query<{
      type: string;
      direction: string;
      account_id: string;
      pair: string | null;
      id: string;
    }>(
      "select id, type, direction, account_id, transfer_pair_id as pair from transactions where household_id = $1 order by direction",
      [s.scope.householdId],
    );
    expect(rows.map((r) => [r.type, r.direction])).toEqual([
      ["transfer", "in"],
      ["transfer", "out"],
    ]);
    expect(rows[0]?.pair).toBe(rows[1]?.id);
    expect(rows[1]?.pair).toBe(rows[0]?.id);
    expect(rows[0]?.account_id).toBe(cash);
  });

  it("STMT-08: перевод на свой накопительный в паре с уже записанным зачислением — взаимная пара", async () => {
    const { s, t, row } = await setup();
    const savings = await s.transaction((tx) =>
      t.accounts.findOrCreate(tx, { bank: "Лесбанк", mask: "9999", currency: "BYN" }),
    );
    const first = await s.transaction((tx) =>
      t.imports.importBatch(tx, {
        importId: randomUUID(),
        rows: [
          row({
            key: "in",
            accountId: savings,
            type: "transfer",
            direction: "in",
            amount: Money.of(50_000, "BYN"),
            amountBynMinor: 50_000,
            category: null,
            occurredOn: "2026-09-11",
          }),
        ],
      }),
    );
    const candidates = await t.imports.transferCandidates(s, {
      from: "2026-09-07",
      to: "2026-09-13",
      excludeAccountIds: [],
    });
    expect(candidates.map((c) => c.id)).toEqual(first.ids);
    const second = await s.transaction((tx) =>
      t.imports.importBatch(tx, {
        importId: randomUUID(),
        rows: [
          row({
            key: "out",
            type: "transfer",
            direction: "out",
            amount: Money.of(50_000, "BYN"),
            amountBynMinor: 50_000,
            category: null,
            pairWithId: first.ids[0],
          }),
        ],
      }),
    );
    const { rows } = await db.owner.query<{ id: string; pair: string }>(
      "select id, transfer_pair_id as pair from transactions where household_id = $1",
      [s.scope.householdId],
    );
    const byId = new Map(rows.map((r) => [r.id, r.pair]));
    expect(byId.get(first.ids[0] ?? "")).toBe(second.ids[0]);
    expect(byId.get(second.ids[0] ?? "")).toBe(first.ids[0]);
    // Пока нет пары у третьего — кандидатов нет (обе уже в паре).
    expect(
      await t.imports.transferCandidates(s, {
        from: "2026-09-07",
        to: "2026-09-13",
        excludeAccountIds: [],
      }),
    ).toEqual([]);
  });

  it("STMT-08: возврат связан с покупкой — уже записанной и из этой же пачки", async () => {
    const { s, t, row } = await setup();
    const purchase = await t.ops.create(
      s,
      entry({
        occurredOn: LocalDate.parse("2026-09-01"),
        amount: Money.of(5_000, "BYN"),
        merchant: "EVROTORG",
      }),
      WEB,
    );
    const candidates = await t.imports.purchaseCandidates(s, {
      merchantKeys: ["EVROTORG"],
      from: "2026-08-01",
      to: "2026-09-30",
    });
    expect(candidates.map((c) => c.id)).toContain(purchase.transaction.id);
    const result = await s.transaction((tx) =>
      t.imports.importBatch(tx, {
        importId: randomUUID(),
        rows: [
          row({ key: "buy", amount: Money.of(3_000, "BYN"), amountBynMinor: 3_000 }),
          row({
            key: "ref1",
            type: "refund",
            direction: "in",
            amount: Money.of(1_000, "BYN"),
            amountBynMinor: 1_000,
            category: { code: "refunds", source: "merchant" },
            refundOfIndex: 0,
          }),
          row({
            key: "ref2",
            type: "refund",
            direction: "in",
            amount: Money.of(2_000, "BYN"),
            amountBynMinor: 2_000,
            category: { code: "refunds", source: "merchant" },
            refundOfId: purchase.transaction.id,
          }),
        ],
      }),
    );
    const { rows } = await db.owner.query<{ id: string; refund_of_id: string | null }>(
      "select id, refund_of_id from transactions where household_id = $1 and type = 'refund' order by amount_minor",
      [s.scope.householdId],
    );
    expect(rows.map((r) => r.refund_of_id)).toEqual([result.ids[0], purchase.transaction.id]);
  });
});

describe("STMT-07: проверка дублей", () => {
  it("пустой список ключей — пустой ответ без запроса", async () => {
    const { s, t } = await setup();
    const found = await t.imports.knownKeys(s, { dedupeKeys: [], externalIds: [] });
    expect(found.dedupe.size + found.external.size).toBe(0);
  });

  it("известные ключи и идентификаторы находятся; чужого домохозяйства — нет", async () => {
    const { s, t, row } = await setup();
    await s.transaction((tx) =>
      t.imports.importBatch(tx, {
        importId: randomUUID(),
        rows: [row({ key: "a|1", externalId: "acc|777" }), row({ key: "b|1" })],
      }),
    );
    const found = await t.imports.knownKeys(s, {
      dedupeKeys: ["a|1", "zzz"],
      externalIds: ["acc|777", "nope"],
    });
    expect([...found.dedupe]).toEqual(["a|1"]);
    expect([...found.external]).toEqual(["acc|777"]);
    const stranger = await t.imports.knownKeys(newScope(db), {
      dedupeKeys: ["a|1"],
      externalIds: ["acc|777"],
    });
    expect(stranger.dedupe.size + stranger.external.size).toBe(0);
  });
});

describe("STMT-11: откат импорта", () => {
  it("удаляет все операции импорта, правленные вручную тоже; остатки возвращаются; чужой импорт не тронут", async () => {
    const { s, t, card, cash, balance, row } = await setup();
    const importId = randomUUID();
    const other = randomUUID();
    const result = await s.transaction((tx) =>
      t.imports.importBatch(tx, {
        importId,
        rows: [
          row({ key: "x1" }),
          row({ key: "x2", amount: Money.of(2_000, "BYN"), amountBynMinor: 2_000 }),
          row({
            key: "atm",
            type: "transfer",
            amount: Money.of(5_000, "BYN"),
            amountBynMinor: 5_000,
            category: null,
            cashCounterpart: true,
          }),
        ],
      }),
    );
    await s.transaction((tx) =>
      t.imports.importBatch(tx, {
        importId: other,
        rows: [row({ key: "y1", amount: Money.of(700, "BYN"), amountBynMinor: 700 })],
      }),
    );
    expect(await balance(card)).toBe(-(1_000 + 2_000 + 5_000 + 700));
    // Одну операцию импорта правят вручную.
    await t.ops.update(
      s,
      { id: TransactionId.parse(result.ids[0]), patch: { note: "моя заметка" } },
      WEB,
    );
    expect(await countEditedInImport(s, importId)).toBe(1);
    const deleted = await s.transaction((tx) => t.imports.deleteImport(tx, importId));
    expect(deleted).toBe(4);
    expect(await balance(card)).toBe(-700);
    expect(await balance(cash)).toBe(0);
    const { rows } = await db.owner.query<{ n: string }>(
      "select count(*)::text as n from transactions where household_id = $1",
      [s.scope.householdId],
    );
    expect(rows[0]?.n).toBe("1");
  });
});
