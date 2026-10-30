// FIN-01, RCPT-09, EXPL-01, EXPL-02 на Postgres: агрегаты операций пачками — переводы не входят, возврат уменьшает расходы
// своей категории, операции без курса не входят в сумму (число — missingRates), операция с разбивкой чека идёт по частям,
// слитая считается один раз, число запросов не растёт с числом категорий, повторный ответ не плодит объяснения.
import { SystemCategoryCode } from "@kosht/contract";
import { LocalDate, Money } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  entry,
  newScope,
  transactionsWithJournal,
  WEB,
} from "../../../main/__fixtures__/transactions-with-journal.ts";
import { makeAggregate } from "./aggregate.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const day = (text: string) => LocalDate.parse(text);
const cat = (code: string) => ({ type: "system" as const, code: SystemCategoryCode.parse(code) });
const OCT = { from: day("2026-10-01"), to: day("2026-10-31") };
const minorOf = (group: { expense: { value: Money } } | undefined) => group?.expense.value.minor;

describe("FIN-01: переводы, возвраты, доходы", () => {
  async function seeded() {
    const s = newScope(db);
    const t = transactionsWithJournal(db);
    const create = (over: Parameters<typeof entry>[0]) => t.ops.create(s, entry(over), WEB);
    await create({
      occurredOn: day("2026-10-03"),
      amount: Money.of(12_000, "BYN"),
      category: cat("groceries"),
      merchant: "Евроопт",
    });
    await create({
      occurredOn: day("2026-10-09"),
      amount: Money.of(8_000, "BYN"),
      category: cat("groceries"),
      merchant: "Евроопт",
    });
    await create({
      occurredOn: day("2026-10-12"),
      amount: Money.of(3_000, "BYN"),
      category: cat("cafes"),
      merchant: "Зерно",
    });
    await create({
      type: "refund",
      occurredOn: day("2026-10-15"),
      amount: Money.of(2_000, "BYN"),
      category: cat("groceries"),
      merchant: "Евроопт",
    });
    await create({
      type: "income",
      occurredOn: day("2026-10-25"),
      amount: Money.of(144_000, "BYN"),
      category: cat("salary"),
      merchant: "ТехноСофт",
    });
    await create({
      type: "transfer",
      category: null,
      occurredOn: day("2026-10-20"),
      amount: Money.of(50_000, "BYN"),
      merchant: "Перевод",
    });
    await create({
      occurredOn: day("2026-09-30"),
      amount: Money.of(99_999, "BYN"),
      category: cat("groceries"),
    });
    return { s, t };
  }

  it("по категориям: продукты 200 − возврат 20 = 180, кафе 30; доходы 1 440; перевод и сентябрь не входят", async () => {
    const { s, t } = await seeded();
    const result = await t.ops.aggregate(s, { ...OCT, groupBy: "category" });
    const byKey = new Map(result.groups.map((g) => [g.key, g]));
    expect(minorOf(byKey.get("system:groceries"))).toBe(18_000);
    expect(minorOf(byKey.get("system:cafes"))).toBe(3_000);
    expect(byKey.get("system:salary")?.income.value.minor).toBe(144_000);
    expect(result.expense.value.minor).toBe(21_000);
    expect(result.income.value.minor).toBe(144_000);
    expect(result.missingRates).toBe(0);
  });

  it("трасса возвращает к операциям: у «Продуктов» — основания покупок и возврата", async () => {
    const { s, t } = await seeded();
    const result = await t.ops.aggregate(s, { ...OCT, groupBy: "category" });
    const groceries = result.groups.find((g) => g.key === "system:groceries");
    expect(groceries?.expense.trace).toMatchObject({
      key: "transactions.categoryTotal",
      op: "sub",
    });
    const refs = JSON.stringify(groceries?.expense.trace);
    expect(refs.match(/"kind":"transaction"/g)).toHaveLength(3);
  });

  it("возвратов больше покупок — отрицательная сумма категории как есть", async () => {
    const s = newScope(db);
    const t = transactionsWithJournal(db);
    await t.ops.create(s, entry({ amount: Money.of(1_000, "BYN"), category: cat("clothes") }), WEB);
    await t.ops.create(
      s,
      entry({ type: "refund", amount: Money.of(4_000, "BYN"), category: cat("clothes") }),
      WEB,
    );
    const result = await t.ops.aggregate(s, { ...OCT, groupBy: "category" });
    expect(minorOf(result.groups.find((g) => g.key === "system:clothes"))).toBe(-3_000);
    expect(result.expense.value.minor).toBe(-3_000);
  });

  it("по месяцам и по контрагентам: те же суммы, другие ключи", async () => {
    const { s, t } = await seeded();
    const months = await t.ops.aggregate(s, {
      from: day("2026-09-01"),
      to: day("2026-10-31"),
      groupBy: "month",
    });
    expect(months.groups.map((g) => g.key)).toEqual(["2026-09", "2026-10"]);
    expect(minorOf(months.groups.find((g) => g.key === "2026-10"))).toBe(21_000);
    const counterparties = await t.ops.aggregate(s, { ...OCT, groupBy: "counterparty" });
    expect(minorOf(counterparties.groups.find((g) => g.key.includes("ЕВРООПТ")))).toBe(18_000);
  });

  it("период без операций — нули, а не ошибка", async () => {
    const s = newScope(db);
    const t = transactionsWithJournal(db);
    const result = await t.ops.aggregate(s, { ...OCT, groupBy: "category" });
    expect(result.groups).toEqual([]);
    expect(result.expense.value.minor).toBe(0);
  });

  it("чужое домохозяйство в сумму не входит", async () => {
    const { t } = await seeded();
    const stranger = newScope(db);
    expect((await t.ops.aggregate(stranger, { ...OCT, groupBy: "category" })).groups).toEqual([]);
  });
});

describe("STMT-09: курс и предварительные операции", () => {
  it("операция в валюте без курса НБРБ не входит в сумму, ответ называет их число (не 0)", async () => {
    const s = newScope(db);
    const t = transactionsWithJournal(db);
    const usd = await t.accounts.create(
      s,
      { kind: "card", name: "USD", bank: null, mask: null, currency: "USD", initialBalance: null },
      "web",
    );
    await t.ops.create(s, entry({ amount: Money.of(500, "BYN"), category: cat("cafes") }), WEB);
    t.setRatesUp(false);
    await t.ops.create(
      s,
      entry({
        accountId: usd.account.id as never,
        amount: Money.of(1_000, "USD"),
        category: cat("cafes"),
      }),
      WEB,
    );
    const result = await t.ops.aggregate(s, { ...OCT, groupBy: "category" });
    expect(result.expense.value.minor).toBe(500);
    expect(result.missingRates).toBe(1);
  });
});

describe("RCPT-09: операция с разбивкой чека идёт по частям", () => {
  it("чек 100,00: продукты 70,00 и дом 30,00 — суммы по своим категориям, операция одна", async () => {
    const s = newScope(db);
    const t = transactionsWithJournal(db);
    const { transaction } = await t.ops.create(
      s,
      entry({ amount: Money.of(10_000, "BYN"), category: cat("groceries") }),
      WEB,
    );
    await db.owner.query(
      `insert into transaction_splits (household_id, user_id, transaction_id, position, category_code, amount_minor)
       values ($1, $2, $3, 1, 'groceries', 7000), ($1, $2, $3, 2, 'household', 3000)`,
      [s.scope.householdId, s.scope.userId, transaction.id],
    );
    const result = await t.ops.aggregate(s, { ...OCT, groupBy: "category" });
    expect(minorOf(result.groups.find((g) => g.key === "system:groceries"))).toBe(7_000);
    expect(minorOf(result.groups.find((g) => g.key === "system:household"))).toBe(3_000);
    expect(result.expense.value.minor).toBe(10_000);
  });

  it("валютная операция: части в пропорции к эквиваленту, сумма частей = эквивалент до копейки", async () => {
    const s = newScope(db);
    const t = transactionsWithJournal(db, {
      rates: { USD: { rateDate: "2026-10-28", rateE4: 29_871, scale: 1 } },
    });
    const usd = await t.accounts.create(
      s,
      { kind: "card", name: "USD", bank: null, mask: null, currency: "USD", initialBalance: null },
      "web",
    );
    const { transaction } = await t.ops.create(
      s,
      entry({
        accountId: usd.account.id as never,
        amount: Money.of(1_000, "USD"),
        category: cat("groceries"),
      }),
      WEB,
    );
    await db.owner.query(
      `insert into transaction_splits (household_id, user_id, transaction_id, position, category_code, amount_minor)
       values ($1, $2, $3, 1, 'groceries', 333), ($1, $2, $3, 2, 'household', 333), ($1, $2, $3, 3, 'cafes', 334)`,
      [s.scope.householdId, s.scope.userId, transaction.id],
    );
    const result = await t.ops.aggregate(s, { ...OCT, groupBy: "category" });
    // 10,00 USD × 2,9871 = 29,87 BYN
    expect(transaction.amountInByn?.minor).toBe(2_987);
    expect(result.expense.value.minor).toBe(2_987);
    expect(result.groups).toHaveLength(3);
  });
});

describe("RCPT-09: число операций группы — по операциям, а не по частям", () => {
  async function splitOperation(
    s: ReturnType<typeof newScope>,
    t: ReturnType<typeof transactionsWithJournal>,
    on: string,
  ) {
    const { transaction } = await t.ops.create(
      s,
      entry({ occurredOn: day(on), amount: Money.of(9_000, "BYN"), category: cat("groceries") }),
      WEB,
    );
    await db.owner.query(
      `insert into transaction_splits (household_id, user_id, transaction_id, position, category_code, amount_minor)
       values ($1, $2, $3, 1, 'groceries', 3000), ($1, $2, $3, 2, 'groceries', 3000), ($1, $2, $3, 3, 'groceries', 3000)`,
      [s.scope.householdId, s.scope.userId, transaction.id],
    );
    return transaction;
  }

  it("операция с тремя частями одной группы: основание одно, «ещё N» не считает части", async () => {
    const s = newScope(db);
    const t = transactionsWithJournal(db);
    const split = await splitOperation(s, t, "2026-10-05");
    const result = await t.ops.aggregate(s, { ...OCT, groupBy: "category" });
    const trace = result.groups.find((g) => g.key === "system:groceries")?.expense.trace.inputs[0];
    expect(trace?.value).toEqual(Money.of(9_000, "BYN"));
    expect(trace?.refs?.map((ref) => ref.id)).toEqual([split.id]);
    expect(trace?.note).toBeUndefined();

    // Вторая, обычная операция и предел в одно основание: остаётся «ещё 1», а не «ещё 3».
    await t.ops.create(
      s,
      entry({
        occurredOn: day("2026-10-06"),
        amount: Money.of(500, "BYN"),
        category: cat("groceries"),
      }),
      WEB,
    );
    const limited = makeAggregate({
      settings: { get: async () => 1 as never },
      explain: t.explain,
    });
    const one = await limited.aggregate(s, { ...OCT, groupBy: "category" });
    const limitedTrace = one.groups.find((g) => g.key === "system:groceries")?.expense.trace
      .inputs[0];
    expect(limitedTrace?.refs).toHaveLength(1);
    expect(limitedTrace?.note).toBe("ещё 1 операций");
  });

  it("разбивка операции вне периода в сумму периода не входит", async () => {
    const s = newScope(db);
    const t = transactionsWithJournal(db);
    await splitOperation(s, t, "2026-09-05");
    const result = await t.ops.aggregate(s, { ...OCT, groupBy: "category" });
    expect(result.groups).toHaveLength(0);
    expect(result.expense.value.minor).toBe(0);
  });
});

describe("EXPL-01: число запросов и основания", () => {
  it("тридцать категорий — столько же запросов, сколько одна (не растёт с числом групп)", async () => {
    const s = newScope(db);
    const t = transactionsWithJournal(db);
    const codes = [
      "groceries",
      "cafes",
      "household",
      "beauty",
      "health",
      "clothes",
      "electronics",
      "home",
      "utilities",
      "rent",
      "telecom",
      "subscriptions",
      "transport",
      "taxi",
      "car",
      "education",
      "kids",
      "pets",
      "leisure",
      "travel",
      "gifts",
      "loans",
      "taxes",
      "fees",
      "other",
    ];
    for (const code of codes)
      await t.ops.create(s, entry({ amount: Money.of(100, "BYN"), category: cat(code) }), WEB);
    const spy = vi.spyOn(db.pool, "query");
    const many = await t.ops.aggregate(s, { ...OCT, groupBy: "category" });
    const manyQueries = spy.mock.calls.length;
    spy.mockClear();
    const one = await t.ops.aggregate(newScope(db), { ...OCT, groupBy: "category" });
    const oneQueries = spy.mock.calls.length;
    spy.mockRestore();
    expect(many.groups).toHaveLength(codes.length);
    expect(one.groups).toHaveLength(0);
    expect(manyQueries).toBeGreaterThan(0);
    expect(manyQueries).toBe(oneQueries);
  });

  it("операций больше предела explain.max-refs: в refs — первые, в пояснении — сколько остальных", async () => {
    const s = newScope(db);
    const t = transactionsWithJournal(db);
    for (let i = 0; i < 5; i += 1)
      await t.ops.create(s, entry({ amount: Money.of(100, "BYN"), category: cat("cafes") }), WEB);
    const limited = makeAggregate({
      settings: { get: async () => 2 as never },
      explain: t.explain,
    });
    const result = await limited.aggregate(s, { ...OCT, groupBy: "category" });
    const trace = result.groups[0]?.expense.trace.inputs[0];
    expect(trace?.refs).toHaveLength(2);
    expect(trace?.note).toBe("ещё 3 операций");
    expect(trace?.value).toEqual(Money.of(500, "BYN"));
  });

  it("EXPL-02: повторный вызов с traceId — те же traceId, строк explanations не больше", async () => {
    const s = newScope(db);
    const t = transactionsWithJournal(db);
    await t.ops.create(s, entry({ amount: Money.of(700, "BYN"), category: cat("cafes") }), WEB);
    const first = await t.ops.aggregateWithTraces(s, { ...OCT, groupBy: "category" });
    const count = async () =>
      (
        await db.owner.query<{ n: number }>(
          "select count(*)::int as n from explanations where household_id = $1",
          [s.scope.householdId],
        )
      ).rows[0]?.n;
    const rows = await count();
    const again = await t.ops.aggregateWithTraces(s, { ...OCT, groupBy: "category" });
    expect(again).toEqual(first);
    expect(await count()).toBe(rows);
    const saved = await t.explain.get(s, first.expenseTraceId);
    expect(saved.trace.value).toEqual(Money.of(700, "BYN"));
  });
});
