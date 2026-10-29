import { Money } from "@kosht/kernel";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { node } from "../calc.ts";
import { balanceChainDifference } from "./balance-chain.ts";

const byn = (key: string, minor: number) => node(key, Money.of(minor, "BYN"));
const ops = (...minors: number[]) => minors.map((m) => byn("statements.operation", m));

describe("STMT-04", () => {
  it("остаток 1 000,00 + поступление 500,00 − покупки 120,50 и 79,50 = 1 300,00: расхождение 0", () => {
    const result = balanceChainDifference({
      opening: byn("statements.openingBalance", 100_000),
      operations: ops(50_000, -12_050, -7_950),
      closing: byn("statements.closingBalance", 130_000),
    });
    expect(result.value).toEqual({ minor: 0, currency: "BYN" });
  });

  it("не хватает операции на 25,00: расхождение называет сумму и знак", () => {
    const result = balanceChainDifference({
      opening: byn("statements.openingBalance", 100_000),
      operations: ops(-12_050),
      closing: byn("statements.closingBalance", 87_950 - 2_500),
    });
    expect(result.value.minor).toBe(-2_500);
  });

  it("трасса: расхождение = конец − ожидаемый конец, а тот — начало и все операции по порядку", () => {
    const result = balanceChainDifference({
      opening: byn("statements.openingBalance", 1_000),
      operations: ops(-200, 50),
      closing: byn("statements.closingBalance", 850),
    });
    expect(result.trace).toMatchObject({ key: "statements.balanceDifference", op: "sub" });
    const [closing, expected] = result.trace.inputs;
    expect(closing?.key).toBe("statements.closingBalance");
    expect(expected?.key).toBe("statements.expectedClosing");
    expect(expected?.inputs.map((input) => input.key)).toEqual([
      "statements.openingBalance",
      "statements.operation",
      "statements.operation",
    ]);
  });

  it("без операций расхождение — разница остатков", () => {
    const result = balanceChainDifference({
      opening: byn("statements.openingBalance", 500),
      operations: [],
      closing: byn("statements.closingBalance", 500),
    });
    expect(result.value.minor).toBe(0);
  });

  it("валюты остатка и операции разные — ошибка программы, а не расхождение", () => {
    expect(() =>
      balanceChainDifference({
        opening: byn("statements.openingBalance", 500),
        operations: [node("statements.operation", Money.of(100, "USD"))],
        closing: byn("statements.closingBalance", 600),
      }),
    ).toThrow(/разных валютах/);
  });

  it("свойство: конец, собранный из начала и операций, всегда сходится", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.array(fc.integer({ min: -100_000, max: 100_000 }), { maxLength: 40 }),
        (opening, amounts) => {
          const closing = amounts.reduce((acc, a) => acc + a, opening);
          const result = balanceChainDifference({
            opening: byn("statements.openingBalance", opening),
            operations: ops(...amounts),
            closing: byn("statements.closingBalance", closing),
          });
          expect(result.value.minor).toBe(0);
        },
      ),
    );
  });
});
