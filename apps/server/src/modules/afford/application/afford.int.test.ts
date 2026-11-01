// AFF-01…08, AFF-04, AFF-05, EXPL-02 на Postgres с настоящими соседями (recurring, fin, accounts, transactions, calendar, budgets,
// norm-tables, explain): три сценария покупки, просадка и цель, которая сдвинется, события календаря, нет регулярного дохода,
// безопасный платёж по ПДН (пример SPEC 3 200 / 800 → 1 280 → 480) и сумма кредита. Ожидаемые числа посчитаны здесь заново
// простым подсчётом по дням — не теми функциями, что в коде.
import type { AffordResult, AffordScenario } from "@kosht/contract";
import { LocalDate, Money } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { affordWithJournal, clock } from "../../../main/__fixtures__/afford-with-journal.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const byn = (minor: number) => ({ minor, currency: "BYN" }) as const;
const TODAY = "2026-10-28";
const JUL_OCT = ["2026-07", "2026-08", "2026-09", "2026-10"];

interface Series {
  merchant: string;
  type: "income" | "expense";
  category: string;
  day: number;
  minor: number;
}

/** Пример FIN-20: доход 2 400, ЖКХ 180, связь 35, кредит 1 200, подписки 145 — раз в месяц; расходы = обязательные платежи. */
const EXAMPLE: readonly Series[] = [
  { merchant: "ТехноСофт", type: "income", category: "salary", day: 5, minor: 240_000 },
  { merchant: "ЕРИП ЖКУ", type: "expense", category: "utilities", day: 14, minor: 18_000 },
  { merchant: "Белтелеком", type: "expense", category: "telecom", day: 12, minor: 3_500 },
  { merchant: "Беларусбанк кредит", type: "expense", category: "loans", day: 23, minor: 120_000 },
  { merchant: "Яндекс Плюс", type: "expense", category: "subscriptions", day: 1, minor: 14_500 },
];

async function setup(series: readonly Series[] = EXAMPLE, extraOps: readonly object[] = []) {
  clock.set(`${TODAY}T09:00:00Z`);
  const a = affordWithJournal(db);
  const s = a.s();
  const ops = JUL_OCT.flatMap((month) =>
    series.map((item) => ({
      date: `${month}-${String(item.day).padStart(2, "0")}`,
      merchant: item.merchant,
      type: item.type,
      amountMinor: item.minor,
      category: item.category,
    })),
  );
  await a.r.seed(s, [...ops, ...extraOps] as never);
  await a.r.recompute(s);
  return { a, s };
}

/** Остаток на конец каждого дня сегодня…конец горизонта: простой подсчёт по событиям (не функции calc). */
function simulate(input: {
  start: number;
  series?: readonly Series[];
  events?: readonly { on: string; minor: number }[];
  price?: { on: string; minor: number };
  daily?: number;
  days?: number;
}): number[] {
  const series = input.series ?? EXAMPLE;
  const events = [...(input.events ?? [])];
  for (const item of series) {
    for (const month of ["2026-11", "2026-12", "2027-01"]) {
      events.push({
        on: `${month}-${String(item.day).padStart(2, "0")}`,
        minor: item.type === "income" ? item.minor : -item.minor,
      });
    }
  }
  const out: number[] = [];
  for (let k = 0; k < (input.days ?? 91); k += 1) {
    const on = LocalDate.addDays(LocalDate.parse(TODAY), k);
    let balance = input.start - (input.daily ?? 0) * k;
    for (const event of events) if (event.on <= on) balance += event.minor;
    if (input.price !== undefined && input.price.on <= on) balance -= input.price.minor;
    out.push(balance);
  }
  return out;
}

const scenario = (result: AffordResult, kind: AffordScenario["kind"]) =>
  result.scenarios.find((item) => item.kind === kind) as AffordScenario;

describe("AFF-02, AFF-03: три сценария по данным пользователя", () => {
  it("покупка 3 000: остатки по дням, минимум и день, следующий доход — всё как при подсчёте по дням", async () => {
    const { a, s } = await setup();
    const result = await a.scenarios(s, { price: byn(300_000) });
    expect(result.today).toBe(TODAY);
    expect(result.horizon).toEqual({ from: TODAY, to: "2027-01-26" });
    expect(result.considered.available.amount).toEqual(byn(336_000));
    expect(result.considered.monthlyIncome?.amount).toEqual(byn(240_000));
    expect(result.considered.monthlyObligations?.amount).toEqual(byn(156_000));
    expect(result.considered.dailySpend?.amount).toEqual(byn(0));
    expect(result.estimate).toBe(false);
    expect(result.needs).toEqual([]);

    const now = simulate({ start: 336_000, price: { on: TODAY, minor: 300_000 } });
    const after = simulate({ start: 336_000, price: { on: "2026-11-05", minor: 300_000 } });
    expect(result.chart.baseline).toEqual(simulate({ start: 336_000 }));
    expect(result.chart.now).toEqual(now);
    expect(result.chart.afterIncome).toEqual(after);
    expect(result.chart.obligationsMonthly).toEqual(byn(156_000));

    const first = scenario(result, "now");
    expect(first).toMatchObject({ status: "ok", on: TODAY, risk: null, recommended: true });
    expect(first.lowest?.amount.amount.minor).toBe(Math.min(...now));
    expect(first.lowest?.on).toBe("2026-11-01");

    const second = scenario(result, "after-income");
    expect(second).toMatchObject({
      status: "ok",
      on: "2026-11-05",
      risk: null,
      recommended: false,
    });
    expect(second.lowest?.amount.amount.minor).toBe(Math.min(...after));
    expect(second.lowest?.on).toBe("2026-12-01");
  });

  it("накопить: 2 400 − 1 560 − обычные траты 0 = 840 в месяц, 3 000 наберутся за 4 месяца — к 28.02.2027", async () => {
    const { a, s } = await setup();
    const save = scenario(await a.scenarios(s, { price: byn(300_000) }), "save");
    expect(save).toMatchObject({ status: "ok", on: null, lowest: null, risk: null });
    expect(save.saving?.monthly.amount).toEqual(byn(84_000));
    expect(save.saving?.months?.value).toBe(4);
    expect(save.saving?.readyOn).toBe("2027-02-28");
  });

  it("обычные траты считаются по истории: расходы сверх обязательных платежей уменьшают остаток по дням и сумму накопления", async () => {
    // Покупки в магазинах за июль–сентябрь (месяцы окна): 410, 380, 430 → среднее расходов 1 966,67 → обычные траты 406,67 в месяц.
    const shops = [
      {
        date: "2026-07-03",
        merchant: "Магазин А",
        type: "expense",
        amountMinor: 41_000,
        category: "groceries",
      },
      {
        date: "2026-08-09",
        merchant: "Магазин Б",
        type: "expense",
        amountMinor: 38_000,
        category: "groceries",
      },
      {
        date: "2026-09-20",
        merchant: "Магазин В",
        type: "expense",
        amountMinor: 43_000,
        category: "groceries",
      },
    ];
    const { a, s } = await setup(EXAMPLE, shops);
    const result = await a.scenarios(s, { price: byn(300_000) });
    // (197 000 + 194 000 + 199 000) ÷ 3 = 196 666,67 → 196 667; минус 156 000 = 40 667 в месяц; × 12 ÷ 365 = 1 337 в день.
    expect(result.considered.dailySpend?.amount).toEqual(byn(1_337));
    // Остаток на карте уже учитывает все операции истории: 336 000 − 41 000 − 38 000 − 43 000.
    expect(result.considered.available.amount).toEqual(byn(214_000));
    expect(result.chart.baseline).toEqual(simulate({ start: 214_000, daily: 1_337 }));
    const save = scenario(result, "save");
    expect(save.saving?.monthly.amount).toEqual(byn(240_000 - 156_000 - 40_667));
    // 300 000 ÷ 43 333 = 6,92 → 7 месяцев (вверх).
    expect(save.saving?.months?.value).toBe(7);
  });

  it("желаемый день покупки в будущем: «сейчас» — это он, после следующего дохода — первый доход после него", async () => {
    const { a, s } = await setup();
    const result = await a.scenarios(s, { price: byn(100_000), on: "2026-11-10" });
    expect(result.purchaseOn).toBe("2026-11-10");
    expect(scenario(result, "now").on).toBe("2026-11-10");
    expect(scenario(result, "after-income").on).toBe("2026-12-05");
    expect(result.chart.now).toEqual(
      simulate({ start: 336_000, price: { on: "2026-11-10", minor: 100_000 } }),
    );
  });
});

describe("AFF-04: просадка с датой и суммой, цели", () => {
  it("покупка 3 500: «сейчас» уходит в минус с сегодняшнего дня, не хватает 285,00 к 01.11; «после дохода» — без риска и рекомендован", async () => {
    const { a, s } = await setup();
    const result = await a.scenarios(s, { price: byn(350_000) });
    const now = scenario(result, "now");
    expect(now.risk).toMatchObject({ firstOn: TODAY, lowestOn: "2026-11-01" });
    expect(now.risk?.shortfall.amount).toEqual(byn(28_500));
    expect(now.lowest?.amount.amount).toEqual(byn(-28_500));
    expect(now.recommended).toBe(false);
    expect(scenario(result, "after-income")).toMatchObject({ risk: null, recommended: true });
  });

  it("нет целей — нехватку закрыть нечем (goalUncovered), цели в ответе нет", async () => {
    const { a, s } = await setup();
    const now = scenario(await a.scenarios(s, { price: byn(350_000) }), "now");
    expect(now).toMatchObject({ goal: null, goalUncovered: true });
  });

  it("цель «Отпуск» с накоплением 1 000 — нехватка 285 закрывается из неё, цель сдвинется на месяц (взнос 750)", async () => {
    const { a, s } = await setup();
    const { goal } = await a.goals.create(
      s,
      {
        name: "Отпуск",
        kind: "piggy",
        target: byn(1_000_000),
        deadline: "2027-10-28",
      } as never,
      "web",
    );
    await a.goals.contribute(s, { goalId: goal.id, amount: byn(100_000) } as never, "web");
    const now = scenario(await a.scenarios(s, { price: byn(350_000) }), "now");
    // Осталось накопить 9 000, до срока 12 месяцев → взнос 750; нехватка 285 → ceil(285 ÷ 750) = 1 месяц.
    expect(now.goal).toMatchObject({ id: goal.id, name: "Отпуск", taken: byn(28_500) });
    expect(now.goal?.shiftMonths.value).toBe(1);
    expect(now.goalUncovered).toBe(false);
  });

  it("накоплено в цели меньше нехватки — цель не названа, нехватка не покрыта", async () => {
    const { a, s } = await setup();
    const { goal } = await a.goals.create(
      s,
      { name: "Отпуск", kind: "piggy", target: byn(1_000_000), deadline: "2027-10-28" } as never,
      "web",
    );
    await a.goals.contribute(s, { goalId: goal.id, amount: byn(10_000) } as never, "web");
    const now = scenario(await a.scenarios(s, { price: byn(350_000) }), "now");
    expect(now).toMatchObject({ goal: null, goalUncovered: true });
  });
});

describe("AFF-02, CAL-08: события календаря", () => {
  it("своё событие с суммой уменьшает остаток со своего дня; налог без суммы не считается и назван в unpriced", async () => {
    const { a, s } = await setup();
    await a.c.events.create(
      s,
      { title: "Оплатить садик", on: "2026-11-02", amount: byn(12_000), type: "own" } as never,
      "web",
    );
    await a.c.setFact(s, { key: "property.apartment", value: true });
    await a.c.sync.run(s);
    const result = await a.scenarios(s, { price: byn(100_000) });
    expect(result.chart.baseline).toEqual(
      simulate({ start: 336_000, events: [{ on: "2026-11-02", minor: -12_000 }] }),
    );
    expect(result.chart.now).toEqual(
      simulate({
        start: 336_000,
        events: [{ on: "2026-11-02", minor: -12_000 }],
        price: { on: TODAY, minor: 100_000 },
      }),
    );
    expect(result.unpriced).toEqual([{ type: "tax", rule: "property-tax", on: "2026-11-15" }]);
  });

  it("регулярные платежи из календаря второй раз не считаются: график без событий совпадает с прогнозом fin", async () => {
    const { a, s } = await setup();
    const forecast = await a.r.fin.forecast(s, { to: LocalDate.parse("2027-01-26") });
    const result = await a.scenarios(s, { price: byn(100_000) });
    expect(result.chart.baseline).toEqual(forecast.days.map((day) => day.balance.value.minor));
  });
});

describe("AFF-08: регулярного дохода нет", () => {
  const spendOnly = EXAMPLE.filter((item) => item.type === "expense");

  it("без ожидаемого дохода: needs = income, оценка, «после дохода» и «накопить» недоступны — причина названа", async () => {
    const { a, s } = await setup(spendOnly);
    const result = await a.scenarios(s, { price: byn(100_000) });
    expect(result.needs).toEqual(["income"]);
    expect(result.estimate).toBe(true);
    expect(result.considered.monthlyIncome).toBeNull();
    expect(scenario(result, "after-income")).toMatchObject({
      status: "unavailable",
      reason: "no-income",
      on: null,
    });
    expect(scenario(result, "save")).toMatchObject({ status: "unavailable", reason: "no-income" });
    expect(scenario(result, "now").status).toBe("ok");
    expect(result.chart.afterIncome).toBeNull();
  });

  it("с названным доходом 2 400 и днём 05.11: сценарии строятся, доход повторяется раз в месяц, оценка сохраняется", async () => {
    const { a, s } = await setup(spendOnly);
    const result = await a.scenarios(s, {
      price: byn(100_000),
      expectedIncome: byn(240_000),
      expectedIncomeOn: "2026-11-05",
    });
    expect(result.needs).toEqual([]);
    expect(result.estimate).toBe(true);
    expect(result.considered.monthlyIncome?.amount).toEqual(byn(240_000));
    const incomes = ["2026-11-05", "2026-12-05", "2027-01-05"].map((on) => ({
      on,
      minor: 240_000,
    }));
    // Остаток на картах: история без доходов, только расходы четырёх месяцев — минус 156 000 × 4.
    const start = -624_000;
    expect(result.chart.baseline).toEqual(simulate({ start, series: spendOnly, events: incomes }));
    expect(scenario(result, "after-income")).toMatchObject({ status: "ok", on: "2026-11-05" });
    expect(scenario(result, "save").saving?.monthly.amount).toEqual(byn(240_000 - 156_000));
  });
});

describe("вход: проверки", () => {
  it.each([
    ["сумма в другой валюте", { price: Money.of(100, "USD") }, "price"],
    ["нулевая сумма", { price: byn(0) }, "price"],
    ["день в прошлом", { price: byn(100), on: "2026-10-27" }, "on"],
    ["день за горизонтом", { price: byn(100), on: "2027-01-27" }, "on"],
    ["доход без дня", { price: byn(100), expectedIncome: byn(100) }, "expectedIncomeOn"],
    [
      "день дохода без суммы",
      { price: byn(100), expectedIncomeOn: "2026-11-05" },
      "expectedIncome",
    ],
    [
      "доход в другой валюте",
      { price: byn(100), expectedIncome: Money.of(100, "EUR"), expectedIncomeOn: "2026-11-05" },
      "expectedIncome",
    ],
    [
      "день дохода в прошлом",
      { price: byn(100), expectedIncome: byn(100), expectedIncomeOn: "2026-10-01" },
      "expectedIncomeOn",
    ],
  ])("%s — VALIDATION с названием поля %s", async (_name, input, field) => {
    const { a, s } = await setup();
    await expect(a.scenarios(s, input as never)).rejects.toMatchObject({
      code: "VALIDATION",
      params: { field },
    });
  });
});

describe("EXPL-02: «Откуда эта цифра?» у каждого числа", () => {
  it("минимум — сохранённый расчёт afford.minBalance с остатком дня в основании; повтор даёт те же id и не плодит строки", async () => {
    const { a, s } = await setup();
    const first = await a.scenarios(s, { price: byn(350_000) });
    const lowest = scenario(first, "now").lowest;
    const saved = await a.r.t.explain.get(s, lowest?.amount.traceId as never);
    expect(saved.trace).toMatchObject({ key: "afford.minBalance", value: lowest?.amount.amount });
    expect(saved.trace.inputs[0]?.key).toBe("afford.balance");

    const count = async () =>
      Number(
        (
          await db.owner.query(
            "select count(*)::int as n from explanations where household_id = $1",
            [s.scope.householdId],
          )
        ).rows[0].n,
      );
    const before = await count();
    const second = await a.scenarios(s, { price: byn(350_000) });
    expect(second).toEqual(first);
    expect(await count()).toBe(before);
  });

  it("у каждого показанного числа есть traceId, и он ведёт к расчёту с тем же значением", async () => {
    const { a, s } = await setup();
    const result = await a.scenarios(s, { price: byn(350_000) });
    const shown = [
      result.considered.available,
      result.considered.dailySpend,
      result.considered.monthlyIncome,
      result.considered.monthlyObligations,
      scenario(result, "now").lowest?.amount,
      scenario(result, "now").risk?.shortfall,
      scenario(result, "save").saving?.monthly,
    ];
    for (const item of shown) {
      expect(item).toBeDefined();
      const saved = await a.r.t.explain.get(s, item?.traceId as never);
      expect(saved.trace.value).toEqual(item?.amount);
    }
  });
});

describe("изоляция: чужие данные", () => {
  it("другое домохозяйство не видит ни остатков, ни платежей: пустой расчёт и дозапрос дохода", async () => {
    const { a } = await setup();
    const stranger = a.s();
    const result = await a.scenarios(stranger, { price: byn(100_000) });
    expect(result.considered.available.amount).toEqual(byn(0));
    expect(result.needs).toEqual(["income"]);
    expect(result.considered.monthlyObligations).toBeNull();
  });
});

describe("AFF-06, P6: без названий банков и программ", () => {
  it("контрагент кредитного платежа и других платежей в результат не попадает — только суммы", async () => {
    const { a, s } = await setup();
    const text = JSON.stringify(await a.scenarios(s, { price: byn(100_000) }));
    for (const name of ["Беларусбанк", "ТехноСофт", "Белтелеком", "Яндекс"]) {
      expect(text).not.toContain(name);
    }
  });
});
