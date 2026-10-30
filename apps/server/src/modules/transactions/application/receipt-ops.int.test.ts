// RCPT-08, RCPT-09, RCPT-10, TXN-01 на Postgres: операция от чека — наличные списываются со счёта «Наличные», карта даёт
// предварительную операцию «ожидает выписки» (остаток не меняется), у операции разбивка по категориям, правка пересчитывает,
// «Отменить» чек убирает операцию и возвращает остаток.
import { Money } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  newScope,
  transactionsWithJournal,
} from "../../../main/__fixtures__/transactions-with-journal.ts";
import { listSplits } from "../infrastructure/db/transactions.repo.ts";
import type { ReceiptOperation } from "./receipt-ops.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const byn = (minor: number) => Money.of(minor, "BYN");

function receipt(over: Partial<ReceiptOperation> = {}): ReceiptOperation {
  return {
    receiptId: randomUUID(),
    method: "cash",
    cardLast4: null,
    occurredOn: "2026-10-12",
    occurredTime: "14:37:22",
    amount: byn(4730),
    merchantName: "Сосновый",
    merchantKey: "СОСНОВЫЙ",
    category: { code: "groceries", source: "keyword" },
    splits: [
      { category: { code: "groceries" }, amount: byn(4000) },
      { category: { code: "other" }, amount: byn(730) },
    ],
    needsReview: false,
    ...over,
  };
}

async function setup() {
  const s = newScope(db);
  const t = transactionsWithJournal(db);
  const cash = await s.transaction((tx) => t.accounts.cash(tx));
  const balance = async (accountId: string = cash) =>
    (await t.accounts.list(s)).items.find((item) => item.id === accountId)?.balance.minor;
  const get = async (id: string) => (await t.ops.get(s, id)).transaction;
  return { s, t, cash, balance, get };
}

describe("RCPT-10: куда попадает операция чека", () => {
  it("наличные (и неизвестный способ) — трата со счёта «Наличные»: остаток уменьшается, разбивка сохранена", async () => {
    const { s, t, cash, balance, get } = await setup();
    const { id, pending } = await s.transaction((tx) => t.ops.recordFromReceipt(tx, receipt()));
    expect(pending).toBe(false);
    expect(await get(id)).toMatchObject({
      accountId: cash,
      type: "expense",
      source: "receipt",
      pending: false,
      needsReview: false,
      amount: { minor: 4730, currency: "BYN" },
      occurredOn: "2026-10-12",
      occurredTime: "14:37",
    });
    expect(await balance()).toBe(-4730);
    const splits = await listSplits(s, id);
    expect(splits.map((split) => [split.categoryCode, split.amountMinor])).toEqual([
      ["groceries", 4000],
      ["other", 730],
    ]);
    const unknown = await s.transaction((tx) =>
      t.ops.recordFromReceipt(tx, receipt({ method: null })),
    );
    expect((await get(unknown.id)).accountId).toBe(cash);
  });

  it("карта с известными цифрами — предварительная операция на счёте этой карты; остаток счёта не меняется", async () => {
    const { s, t, balance, get } = await setup();
    const card = await s.transaction((tx) =>
      t.accounts.findOrCreate(tx, { bank: "Лесбанк", mask: "4417", currency: "BYN" }),
    );
    const { id, pending } = await s.transaction((tx) =>
      t.ops.recordFromReceipt(tx, receipt({ method: "card", cardLast4: "4417" })),
    );
    expect(pending).toBe(true);
    expect(await get(id)).toMatchObject({ accountId: card, pending: true, source: "receipt" });
    expect(await balance(card)).toBe(0);
  });

  it("карта с неизвестными цифрами — «Карта, не указана»; две карты с теми же цифрами — тоже она", async () => {
    const { s, t, balance, get } = await setup();
    const unknown = await s.transaction((tx) => t.accounts.unknownCard(tx));
    const first = await s.transaction((tx) =>
      t.ops.recordFromReceipt(tx, receipt({ method: "card", cardLast4: "9999" })),
    );
    expect((await get(first.id)).accountId).toBe(unknown);
    await s.transaction(async (tx) => {
      await t.accounts.findOrCreate(tx, { bank: "Банк А", mask: "1111", currency: "BYN" });
      await t.accounts.findOrCreate(tx, { bank: "Банк Б", mask: "1111", currency: "BYN" });
    });
    const second = await s.transaction((tx) =>
      t.ops.recordFromReceipt(tx, receipt({ method: "card", cardLast4: "1111" })),
    );
    expect((await get(second.id)).accountId).toBe(unknown);
    expect(await balance(unknown)).toBe(0);
  });

  it("повторная запись того же чека не создаёт вторую операцию", async () => {
    const { s, t, balance } = await setup();
    const input = receipt();
    const a = await s.transaction((tx) => t.ops.recordFromReceipt(tx, input));
    const b = await s.transaction((tx) => t.ops.recordFromReceipt(tx, input));
    expect(b.id).toBe(a.id);
    expect(await balance()).toBe(-4730);
  });
});

describe("RCPT-08: правка и «Отменить» чек", () => {
  it("правка позиций пересчитала сумму и разбивку: остаток «Наличных» меняется на разницу, версия растёт", async () => {
    const { s, t, balance, get } = await setup();
    const input = receipt();
    const { id } = await s.transaction((tx) => t.ops.recordFromReceipt(tx, input));
    await s.transaction((tx) =>
      t.ops.updateFromReceipt(tx, {
        ...input,
        amount: byn(3000),
        category: { code: "cafes", source: "user" },
        splits: [{ category: { code: "cafes" }, amount: byn(3000) }],
        needsReview: true,
      }),
    );
    expect(await get(id)).toMatchObject({
      amount: { minor: 3000 },
      category: { type: "system", code: "cafes" },
      needsReview: true,
      version: 2,
    });
    expect(await balance()).toBe(-3000);
    expect((await listSplits(s, id)).map((split) => split.amountMinor)).toEqual([3000]);
  });

  it("«Верно» снимает признак «требует проверки», не трогая сумму", async () => {
    const { s, t, get } = await setup();
    const input = receipt({ needsReview: true });
    const { id } = await s.transaction((tx) => t.ops.recordFromReceipt(tx, input));
    await s.transaction((tx) => t.ops.setReceiptReviewed(tx, input.receiptId, false));
    expect(await get(id)).toMatchObject({ needsReview: false, amount: { minor: 4730 } });
  });

  it("«Отменить» чек удаляет его операцию и возвращает остаток «Наличных»; разбивка уходит вместе с ней", async () => {
    const { s, t, balance } = await setup();
    const input = receipt();
    const { id } = await s.transaction((tx) => t.ops.recordFromReceipt(tx, input));
    await s.transaction((tx) => t.ops.removeForReceipt(tx, input.receiptId));
    expect(await balance()).toBe(0);
    expect(await t.ops.operationOfReceipt(s, input.receiptId)).toBeUndefined();
    expect(await listSplits(s, id)).toEqual([]);
    await s.transaction((tx) => t.ops.removeForReceipt(tx, input.receiptId));
  });

  it("предварительная операция при «Отменить» исчезает, остаток карты не двигается", async () => {
    const { s, t, balance } = await setup();
    const card = await s.transaction((tx) => t.accounts.unknownCard(tx));
    const input = receipt({ method: "card", cardLast4: null });
    await s.transaction((tx) => t.ops.recordFromReceipt(tx, input));
    await s.transaction((tx) => t.ops.removeForReceipt(tx, input.receiptId));
    expect(await balance(card)).toBe(0);
    expect(await t.ops.operationOfReceipt(s, input.receiptId)).toBeUndefined();
  });

  it("правка и «Верно» чека без операции ничего не делают", async () => {
    const { s, t } = await setup();
    const input = receipt();
    await s.transaction((tx) => t.ops.updateFromReceipt(tx, input));
    await s.transaction((tx) => t.ops.setReceiptReviewed(tx, input.receiptId, false));
    expect(await t.ops.operationOfReceipt(s, input.receiptId)).toBeUndefined();
  });
});

describe("TXN-01: список — признак и фильтры «есть чек», «требует проверки»", () => {
  it("фильтры отбирают операции с чеком и с чеком на проверке; у ручной операции чека нет", async () => {
    const { s, t } = await setup();
    const a = await s.transaction((tx) => t.ops.recordFromReceipt(tx, receipt()));
    const b = await s.transaction((tx) =>
      t.ops.recordFromReceipt(tx, receipt({ needsReview: true })),
    );
    const withReceipt = await t.ops.list(s, { hasReceipt: true, page: 1, pageSize: 50 });
    expect(withReceipt.items.map((item) => item.id).toSorted()).toEqual([a.id, b.id].toSorted());
    const review = await t.ops.list(s, { needsReview: true, page: 1, pageSize: 50 });
    expect(review.items.map((item) => item.id)).toEqual([b.id]);
    expect(review.items[0]).toMatchObject({ receiptId: expect.any(String), needsReview: true });
    const without = await t.ops.list(s, { hasReceipt: false, page: 1, pageSize: 50 });
    expect(without.items).toEqual([]);
  });
});
