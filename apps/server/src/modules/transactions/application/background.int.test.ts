// CAT-03, CAT-06, STMT-09 на Postgres: категория без выбора — правила сразу, непокрытое — «Прочее» и модель в фоне
// (шпион шлюза); курс НБРБ, которого не было, досчитывает фон и шлёт transactions.changed; версия операции от фона
// не растёт, а то, что человек успел выбрать сам, фон не перетирает.
import { Money } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  entry,
  newScope,
  transactionsWithJournal,
  WEB,
} from "./__fixtures__/transactions-with-journal.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const USD = { rateDate: "2026-10-28", rateE4: 29_871, scale: 1 };

async function setup(options: Parameters<typeof transactionsWithJournal>[1] = {}) {
  const s = newScope(db);
  const t = transactionsWithJournal(db, options);
  await s.transaction((tx) => t.accounts.cash(tx));
  return { s, t };
}

describe("CAT-03: категория, которую не выбрали", () => {
  it("известный контрагент — категория по справочнику без модели, источник «справочник» или «ключевое слово»", async () => {
    const { s, t } = await setup();
    const { transaction } = await t.ops.create(
      s,
      entry({ merchant: "YANDEX.GO TAXI MINSK", category: null }),
      WEB,
    );
    expect(transaction.category).toEqual({ type: "system", code: "taxi" });
    expect(["merchant", "keyword"]).toContain(transaction.categorySource);
    expect(t.enqueued).toEqual([]);
    expect(t.modelCalls).toEqual([]);
  });

  it("непокрытое правилами — «Прочее» с источником fallback и задача categorize", async () => {
    const { s, t } = await setup();
    const { transaction } = await t.ops.create(
      s,
      entry({ merchant: "ZQXW VKLMN", category: null }),
      WEB,
    );
    expect(transaction.category).toEqual({ type: "system", code: "other" });
    expect(transaction.categorySource).toBe("fallback");
    expect(t.enqueued).toEqual([
      { name: "transactions.categorize", payload: { ids: [transaction.id] } },
    ]);
    expect(t.modelCalls).toEqual([]);
  });
});

describe("CAT-06: модель в фоне", () => {
  it("задача categorize: модель выбрала «Кафе» — категория обновлена, источник «модель», версия и остаток не тронуты, в истории канал system", async () => {
    const { s, t } = await setup({ model: () => [{ line: 1, label: "cafes" }] });
    const { transaction } = await t.ops.create(
      s,
      entry({ merchant: "ZQXW VKLMN", category: null }),
      WEB,
    );
    await t.background.categorizeFallback(s, [transaction.id]);
    const card = await t.ops.get(s, transaction.id);
    expect(card.transaction).toMatchObject({
      category: { type: "system", code: "cafes" },
      categorySource: "model",
      version: 1,
    });
    expect(card.history.at(-1)).toEqual({
      at: expect.any(String),
      action: "updated",
      channel: "system",
      fields: ["category"],
    });
    expect(t.modelCalls).toHaveLength(1);
    expect(t.published.at(-1)).toEqual({ name: "transactions.changed", ids: [transaction.id] });
  });

  it("человек успел выбрать категорию — модель не зовётся и выбор не перетирается", async () => {
    const { s, t } = await setup({ model: () => [{ line: 1, label: "cafes" }] });
    const { transaction } = await t.ops.create(
      s,
      entry({ merchant: "ZQXW VKLMN", category: null }),
      WEB,
    );
    await t.ops.update(
      s,
      { id: transaction.id, patch: { category: { type: "system", code: "taxi" } } },
      WEB,
    );
    await t.background.categorizeFallback(s, [transaction.id]);
    expect(t.modelCalls).toEqual([]);
    expect((await t.ops.get(s, transaction.id)).transaction).toMatchObject({
      category: { type: "system", code: "taxi" },
      categorySource: "user",
    });
  });

  it("модель ничего не знает — «Прочее» остаётся, задача не падает", async () => {
    const { s, t } = await setup();
    const { transaction } = await t.ops.create(
      s,
      entry({ merchant: "ZQXW VKLMN", category: null }),
      WEB,
    );
    await t.background.categorizeFallback(s, [transaction.id]);
    expect((await t.ops.get(s, transaction.id)).transaction).toMatchObject({
      categorySource: "fallback",
    });
  });
});

describe("STMT-09: фон досчитывает курс", () => {
  async function usdOperation(
    t: Awaited<ReturnType<typeof setup>>["t"],
    s: Awaited<ReturnType<typeof setup>>["s"],
  ) {
    const usd = await t.accounts.create(
      s,
      { kind: "card", name: "USD", bank: null, mask: null, currency: "USD", initialBalance: null },
      "web",
    );
    t.setRatesUp(false);
    const created = await t.ops.create(
      s,
      entry({ accountId: usd.account.id, amount: Money.of(10_000, "USD") }),
      WEB,
    );
    return created;
  }

  it("НБРБ всё ещё молчит — UNAVAILABLE для повтора очереди, операция без суммы в BYN как была", async () => {
    const { s, t } = await setup({ rates: { USD } });
    const { transaction } = await usdOperation(t, s);
    await expect(t.background.fillRates(s, [transaction.id])).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect((await t.ops.get(s, transaction.id)).transaction.amountInByn).toBeNull();
  });

  it("курс появился: сумма в BYN проставлена, версия та же, transactions.changed, в истории — канал system; повтор — без эффекта", async () => {
    const { s, t } = await setup({ rates: { USD } });
    const { transaction } = await usdOperation(t, s);
    t.setRatesUp(true);
    const before = t.published.length;
    await t.background.fillRates(s, [transaction.id]);
    const card = await t.ops.get(s, transaction.id);
    expect(card.transaction).toMatchObject({ amountInByn: { minor: 29_871 }, version: 1 });
    expect(card.rate).toEqual({ rateE4: 29_871, scale: 1, date: "2026-10-28" });
    expect(card.history.at(-1)).toMatchObject({
      action: "updated",
      channel: "system",
      fields: ["amountInByn"],
    });
    expect(t.published.slice(before)).toEqual([
      { name: "transactions.changed", ids: [transaction.id] },
    ]);
    await t.background.fillRates(s, [transaction.id]);
    expect(t.published.slice(before)).toHaveLength(1);
  });

  it("«Отменить» создания после того, как фон досчитал курс, всё равно работает (версия не менялась)", async () => {
    const { s, t } = await setup({ rates: { USD } });
    const { transaction, undoToken } = await usdOperation(t, s);
    t.setRatesUp(true);
    await t.background.fillRates(s, [transaction.id]);
    expect(await t.actions.undo(s, undoToken)).toBe("undone");
    await expect(t.ops.get(s, transaction.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("правка суммы операции без курса пробует курс снова и, если он появился, сохраняет его сразу", async () => {
    const { s, t } = await setup({ rates: { USD } });
    const { transaction } = await usdOperation(t, s);
    t.setRatesUp(true);
    const { transaction: edited } = await t.ops.update(
      s,
      { id: transaction.id, patch: { amount: Money.of(20_000, "USD") } },
      WEB,
    );
    expect(edited.amountInByn).toEqual({ minor: 59_742, currency: "BYN" });
  });
});
