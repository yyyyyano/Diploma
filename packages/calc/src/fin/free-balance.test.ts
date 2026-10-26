// FIN-20: свободный остаток = средний регулярный доход − средние обязательные платежи, с разбивкой (EXPL-01).
import { Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { node } from "../calc.ts";
import { TRACE_KEYS } from "../trace-keys.ts";
import { freeBalance } from "./free-balance.ts";

const byn = (key: string, minor: number) => node(key, Money.of(minor, "BYN"));

describe("FIN-20", () => {
  it("2 400 − 180 − 35 − 1 200 − 145 = 840 BYN, в трассе пять слагаемых по порядку", () => {
    const result = freeBalance({
      averageIncome: byn("fin.avgIncome", 240_000),
      averageObligations: [
        byn("fin.obligation.utilities", 18_000),
        byn("fin.obligation.telecom", 3_500),
        byn("fin.obligation.loan", 120_000),
        byn("fin.obligation.subscriptions", 14_500),
      ],
    });
    expect(result.value).toEqual({ minor: 84_000, currency: "BYN" });
    expect(result.trace).toMatchObject({ key: "fin.freeBalance", op: "sub" });
    expect(result.trace.inputs.map((input) => [input.key, (input.value as Money).minor])).toEqual([
      ["fin.avgIncome", 240_000],
      ["fin.obligation.utilities", 18_000],
      ["fin.obligation.telecom", 3_500],
      ["fin.obligation.loan", 120_000],
      ["fin.obligation.subscriptions", 14_500],
    ]);
  });

  it("без обязательных платежей свободный остаток равен среднему доходу", () => {
    const result = freeBalance({
      averageIncome: byn("fin.avgIncome", 240_000),
      averageObligations: [],
    });
    expect(result.value.minor).toBe(240_000);
  });

  it("платежи больше дохода — свободный остаток отрицательный, а не ноль", () => {
    const result = freeBalance({
      averageIncome: byn("fin.avgIncome", 100_000),
      averageObligations: [byn("fin.obligation.loan", 120_000)],
    });
    expect(result.value.minor).toBe(-20_000);
  });
});

describe("EXPL-01: ключ трассы свободного остатка — в общем реестре", () => {
  it("fin.freeBalance есть в TRACE_KEYS (подпись проверяет тест словаря formulas)", () => {
    const income = node("fin.averageIncome", Money.of(240_000, "BYN"));
    expect(TRACE_KEYS).toContain(
      freeBalance({ averageIncome: income, averageObligations: [] }).trace.key,
    );
    expect(TRACE_KEYS).toContain(income.trace.key);
  });
});
