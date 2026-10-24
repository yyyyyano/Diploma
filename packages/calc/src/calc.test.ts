// P2, ADR-0017: любое число расчёта — Calc<T> = { value, trace }; лист трассы — исходное значение с основаниями.
import { CurrencyMismatchError, Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { node } from "./calc.ts";
import { sum } from "./money-ops.ts";

describe("node — исходное значение трассы", () => {
  it("сумма с основанием-операцией становится листом трассы", () => {
    const salary = node("fin.income", Money.of(240000, "BYN"), {
      refs: [{ kind: "transaction", id: "op-1" }],
    });
    expect(salary).toEqual({
      value: { minor: 240000, currency: "BYN" },
      trace: {
        key: "fin.income",
        op: "value",
        value: { minor: 240000, currency: "BYN" },
        inputs: [],
        refs: [{ kind: "transaction", id: "op-1" }],
      },
    });
  });

  it("ставка 13 % — целое в базисных пунктах, с пояснением", () => {
    expect(node("tax.rate", 1300, { note: "НК ст. 214" }).trace).toEqual({
      key: "tax.rate",
      op: "value",
      value: 1300,
      inputs: [],
      refs: [],
      note: "НК ст. 214",
    });
  });

  it("дробное число — ошибка: ставки в базисных пунктах, деньги в копейках", () => {
    expect(() => node("tax.rate", 13.5)).toThrow(RangeError);
  });

  it("деньги в обход Money.of (дробные копейки) — ошибка", () => {
    expect(() => node("fin.income", { minor: 0.5, currency: "BYN" })).toThrow(RangeError);
  });
});

describe("валюты", () => {
  it("BYN и USD в одной сумме — ошибка: сначала пересчёт по курсу", () => {
    const byn = node("fin.a", Money.of(100, "BYN"));
    const usd = node("fin.b", Money.of(100, "USD"));
    expect(() => sum("fin.total", [byn, usd])).toThrow(CurrencyMismatchError);
  });
});
