// AFF-03…05: примеры SPEC и свойства расчётов покупки — безопасный платёж по ПДН, сумма кредита по аннуитету, остатки сценариев,
// минимум и просадка, накопление. Эталонные значения аннуитета посчитаны независимо точными дробями (Python, Fraction).
import { LocalDate, Money } from "@kosht/kernel";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { node, type Calc } from "../calc.ts";
import { forecastBalances } from "../fin/forecast.ts";
import {
  annuityPrincipal,
  firstBelowZero,
  lowestBalance,
  monthsToCover,
  safePayment,
  savingsPlan,
  scenarioBalances,
  shortfall,
} from "./afford.ts";

const byn = (minor: number): Money => Money.of(minor, "BYN");
const money = (key: string, minor: number): Calc<Money> => node(key, byn(minor));
const day = (text: string) => LocalDate.parse(text);

describe("AFF-05: безопасный платёж по ПДН", () => {
  it("пример SPEC: доход 3 200, предел 40 %, по кредитам 800 → предел 1 280, новый платёж до 480", () => {
    const result = safePayment({
      income: money("afford.income", 320_000),
      limitBp: node("afford.pdnLimit", 4000),
      currentPayments: money("afford.currentPayments", 80_000),
    });
    expect(result.limitAmount.value).toEqual(byn(128_000));
    expect(result.room.value).toEqual(byn(48_000));
    expect(result.room.trace.key).toBe("afford.safePayment");
    expect(result.room.trace.inputs.map((input) => input.key)).toEqual([
      "afford.pdnLimitAmount",
      "afford.currentPayments",
    ]);
  });

  it("предел 50 % для белорусских товаров: тот же доход → предел 1 600, платёж до 800", () => {
    const result = safePayment({
      income: money("afford.income", 320_000),
      limitBp: node("afford.pdnLimit", 5000),
      currentPayments: money("afford.currentPayments", 80_000),
    });
    expect(result.room.value).toEqual(byn(80_000));
  });

  it("предел округляется вниз до копейки: 33,33 × 40 % = 13,33", () => {
    const result = safePayment({
      income: money("afford.income", 3333),
      limitBp: node("afford.pdnLimit", 4000),
      currentPayments: money("afford.currentPayments", 0),
    });
    expect(result.limitAmount.value).toEqual(byn(1333));
  });

  it("текущие платежи выше предела — запас отрицательный, а не ноль", () => {
    const result = safePayment({
      income: money("afford.income", 100_000),
      limitBp: node("afford.pdnLimit", 4000),
      currentPayments: money("afford.currentPayments", 50_000),
    });
    expect(result.room.value).toEqual(byn(-10_000));
  });

  it("нулевой доход и предел вне 0…100 % — ошибка вызывающего", () => {
    const base = {
      income: money("afford.income", 100_000),
      limitBp: node("afford.pdnLimit", 4000),
      currentPayments: money("afford.currentPayments", 0),
    };
    expect(() => safePayment({ ...base, income: money("afford.income", 0) })).toThrow(RangeError);
    expect(() => safePayment({ ...base, limitBp: node("afford.pdnLimit", 0) })).toThrow(RangeError);
    expect(() => safePayment({ ...base, limitBp: node("afford.pdnLimit", 10_001) })).toThrow(
      RangeError,
    );
  });
});

describe("AFF-05: сумма кредита по аннуитету", () => {
  const maxLoan = (paymentMinor: number, rateBp: number, months: number) =>
    annuityPrincipal(
      money("afford.safePayment", paymentMinor),
      node("afford.rate", rateBp),
      node("afford.term", months),
    );

  it.each([
    [48_000, 1400, 60, 2_062_896],
    [128_000, 1550, 36, 3_666_499],
    [55_000, 1400, 36, 1_609_239],
    [100, 10_000, 1, 92],
  ])("платёж %d коп., %d б. п., %d мес. → %d коп. (вниз до копейки)", (p, rate, n, expected) => {
    expect(maxLoan(p, rate, n).value).toEqual(byn(expected));
  });

  it("ставка 0 — платёж × срок: 480 × 36 = 17 280", () => {
    expect(maxLoan(48_000, 0, 36).value).toEqual(byn(1_728_000));
  });

  it("трасса: платёж, ставка и срок — аргументы, правило округления в пояснении", () => {
    const result = maxLoan(48_000, 1400, 60);
    expect(result.trace.key).toBe("afford.maxLoan");
    expect(result.trace.inputs.map((input) => input.key)).toEqual([
      "afford.safePayment",
      "afford.rate",
      "afford.term",
    ]);
    expect(result.trace.note).toContain("rounding=floor-kopeck");
  });

  it("срок вне 1…600 месяцев, дробный срок, ставка вне 0…100 %, платёж не больше нуля — RangeError", () => {
    expect(() => maxLoan(48_000, 1400, 0)).toThrow(RangeError);
    expect(() => maxLoan(48_000, 1400, 601)).toThrow(RangeError);
    expect(() => maxLoan(48_000, 1400, 1.5)).toThrow(RangeError);
    expect(() => maxLoan(48_000, -1, 12)).toThrow(RangeError);
    expect(() => maxLoan(48_000, 10_001, 12)).toThrow(RangeError);
    expect(() => maxLoan(0, 1400, 12)).toThrow(RangeError);
  });

  it("свойство: кредит погашается платежами P за n месяцев, а на копейку больше — уже нет (проверка шагами)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 500_000 }),
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 1, max: 120 }),
        (payment, rateBp, months) => {
          const principal = maxLoan(payment, rateBp, months).value.minor;
          // Погашение шагами в числах с плавающей точкой (только в тесте): остаток после n платежей почти нулевой.
          const r = rateBp / 120_000;
          const residual = (start: number) => {
            let balance = start;
            for (let i = 0; i < months; i += 1) balance = balance * (1 + r) - payment;
            return balance;
          };
          expect(residual(principal)).toBeLessThanOrEqual(1);
          expect(residual(principal + 100)).toBeGreaterThan(0);
        },
      ),
    );
  });

  it("свойство: сумма кредита растёт со сроком и убывает со ставкой", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 500_000 }),
        fc.integer({ min: 0, max: 4000 }),
        fc.integer({ min: 1, max: 119 }),
        (payment, rateBp, months) => {
          expect(maxLoan(payment, rateBp, months + 1).value.minor).toBeGreaterThanOrEqual(
            maxLoan(payment, rateBp, months).value.minor,
          );
          expect(maxLoan(payment, rateBp + 100, months).value.minor).toBeLessThanOrEqual(
            maxLoan(payment, rateBp, months).value.minor,
          );
        },
      ),
    );
  });
});

/** Прогноз без покупки: остаток 1 000, платёж 300 на третий день, поступление 2 000 на пятый. */
const base = () =>
  forecastBalances({
    from: day("2026-10-28"),
    to: day("2026-11-03"),
    start: money("accounts.available", 100_000),
    incomes: [{ on: day("2026-11-01"), amount: money("fin.expectedIncome", 200_000) }],
    payments: [{ on: day("2026-10-30"), amount: money("fin.expectedPayment", 30_000) }],
  });

describe("AFF-03: остаток по дням в сценарии", () => {
  it("покупка 800 со второго дня: остаток падает на сумму покупки с её дня и дальше", () => {
    const days = scenarioBalances({
      base: base(),
      incomes: [],
      payments: [],
      dailySpend: null,
      purchase: { on: day("2026-10-29"), amount: money("afford.purchase", 80_000) },
    });
    expect(days.map((d) => d.balance.value.minor)).toEqual([
      100_000, 20_000, -10_000, -10_000, 190_000, 190_000, 190_000,
    ]);
  });

  it("без покупки, событий и трат остатки берутся из прогноза как есть", () => {
    const forecast = base();
    const days = scenarioBalances({
      base: forecast,
      incomes: [],
      payments: [],
      dailySpend: null,
      purchase: null,
    });
    expect(days).toEqual(forecast);
  });

  it("события календаря: платёж 100 на второй день и поступление 50 на третий меняют остаток со своего дня", () => {
    const days = scenarioBalances({
      base: base(),
      incomes: [{ on: day("2026-10-30"), amount: money("afford.extraIncome", 5_000) }],
      payments: [{ on: day("2026-10-29"), amount: money("afford.extraPayment", 10_000) }],
      dailySpend: null,
      purchase: null,
    });
    expect(days.map((d) => d.balance.value.minor)).toEqual([
      100_000, 90_000, 65_000, 65_000, 265_000, 265_000, 265_000,
    ]);
  });

  it("обычные траты 20 в день не касаются сегодняшнего дня и копятся со следующего", () => {
    const days = scenarioBalances({
      base: base(),
      incomes: [],
      payments: [],
      dailySpend: money("afford.dailySpend", 2_000),
      purchase: null,
    });
    expect(days.map((d) => d.balance.value.minor)).toEqual([
      100_000, 98_000, 66_000, 64_000, 262_000, 260_000, 258_000,
    ]);
  });

  it("трасса дня включает покупку и остаток прогноза", () => {
    const [, second] = scenarioBalances({
      base: base(),
      incomes: [],
      payments: [],
      dailySpend: null,
      purchase: { on: day("2026-10-29"), amount: money("afford.purchase", 80_000) },
    });
    expect(second?.balance.trace.key).toBe("afford.balance");
    expect(second?.balance.trace.inputs.map((input) => input.key)).toEqual([
      "fin.forecastBalance",
      "afford.purchase",
    ]);
  });
});

describe("AFF-04: минимум и просадка", () => {
  const withPurchase = () =>
    scenarioBalances({
      base: base(),
      incomes: [],
      payments: [],
      dailySpend: null,
      purchase: { on: day("2026-10-28"), amount: money("afford.purchase", 130_000) },
    });

  it("минимум — наименьший остаток и его день; при равенстве — ранний", () => {
    const low = lowestBalance(withPurchase());
    expect(low.on).toBe("2026-10-30");
    expect(low.balance.value).toEqual(byn(-60_000));
    expect(low.balance.trace.key).toBe("afford.minBalance");
    expect(lowestBalance(base()).on).toBe("2026-10-30");
  });

  it("первый день ниже нуля — сразу после покупки; без просадки — null", () => {
    expect(firstBelowZero(withPurchase())).toBe("2026-10-28");
    expect(firstBelowZero(base())).toBeNull();
  });

  it("не хватает: 600,00 — нужный минимум 0 минус остаток −600,00; хватает — null", () => {
    const low = lowestBalance(withPurchase());
    const lacks = shortfall(low.balance);
    expect(lacks?.value).toEqual(byn(60_000));
    expect(lacks?.trace.inputs.map((input) => input.key)).toEqual([
      "afford.reserve",
      "afford.minBalance",
    ]);
    expect(shortfall(lowestBalance(base()).balance)).toBeNull();
  });

  it("остаток ровно ноль — не просадка", () => {
    const days = scenarioBalances({
      base: base(),
      incomes: [],
      payments: [],
      dailySpend: null,
      purchase: { on: day("2026-10-28"), amount: money("afford.purchase", 70_000) },
    });
    expect(lowestBalance(days).balance.value).toEqual(byn(0));
    expect(shortfall(lowestBalance(days).balance)).toBeNull();
    expect(firstBelowZero(days)).toBeNull();
  });

  it("пустой прогноз — RangeError", () => {
    expect(() => lowestBalance([])).toThrow(RangeError);
  });
});

describe("AFF-03: накопить", () => {
  const plan = (income: number, obligations: number, spend: number, price: number) =>
    savingsPlan({
      income: money("fin.averageIncome", income),
      obligations: money("afford.obligations", obligations),
      discretionary: money("afford.discretionary", spend),
      price: money("afford.purchase", price),
    });

  it("доход 2 400 − обязательные 677,77 − обычные 1 380 = 342,23 в месяц; 3 000 наберутся за 9 месяцев (вверх)", () => {
    const result = plan(240_000, 67_777, 138_000, 300_000);
    expect(result.monthly.value).toEqual(byn(34_223));
    expect(result.months?.value).toBe(9);
    expect(result.months?.trace.key).toBe("afford.monthsToSave");
    expect(result.months?.trace.note).toContain("rounding=ceil-kopeck");
  });

  it("сумма делится нацело — без лишнего месяца", () => {
    expect(plan(100_000, 0, 0, 300_000).months?.value).toBe(3);
  });

  it("откладывать нечего (≤ 0) — месяцев нет, остаток в месяц виден как есть", () => {
    const result = plan(100_000, 60_000, 50_000, 300_000);
    expect(result.monthly.value).toEqual(byn(-10_000));
    expect(result.months).toBeNull();
    expect(plan(100_000, 100_000, 0, 300_000).months).toBeNull();
  });

  it("monthsToCover: сумма и взнос — больше нуля, валюта одна", () => {
    expect(() => monthsToCover("afford.goalShift", money("a", 0), money("b", 100))).toThrow(
      RangeError,
    );
    expect(() => monthsToCover("afford.goalShift", money("a", 100), money("b", 0))).toThrow(
      RangeError,
    );
    expect(monthsToCover("afford.goalShift", money("a", 73_944), money("b", 10_500)).value).toBe(8);
  });
});
