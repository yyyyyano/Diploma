// AGT-03 «калькулятор», P1, P2: «урезать на треть», «умножить на 12», доля в процентах — целыми копейками, с трассой.
import { Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { node } from "../calc.ts";
import { dayCount, ratioPercent, scaleMoney } from "./calculator.ts";

const byn = (minor: number) => node("calculator.operand", Money.of(minor, "BYN"));
const int = (key: string, value: number) => node(key, value);
const half = { rounding: "half-up-kopeck" } as const;

describe("scaleMoney: сумма × числитель ÷ знаменатель", () => {
  it("кафе за лето 1 000,00 BYN, урезать на треть — 333,33 BYN, округление записано в трассе", () => {
    const result = scaleMoney(
      "calculator.scale",
      byn(100_000),
      int("calculator.numerator", 1),
      int("calculator.denominator", 3),
      half,
    );
    expect(result.value).toEqual(Money.of(33_333, "BYN"));
    expect(result.trace.note).toContain("rounding=half-up-kopeck");
    expect(result.trace.inputs.map((input) => input.key)).toEqual([
      "calculator.operand",
      "calculator.numerator",
      "calculator.denominator",
    ]);
  });

  it("умножить на 12: 15,25 BYN × 12 ÷ 1 — 183,00 BYN", () => {
    const result = scaleMoney(
      "calculator.scale",
      byn(1_525),
      int("calculator.numerator", 12),
      int("calculator.denominator", 1),
      half,
    );
    expect(result.value).toEqual(Money.of(18_300, "BYN"));
  });

  it("половина копейки округляется от нуля, в обе стороны", () => {
    const scale = (minor: number) =>
      scaleMoney("calculator.scale", byn(minor), int("n", 1), int("d", 2), half).value.minor;
    expect(scale(3)).toBe(2);
    expect(scale(-3)).toBe(-2);
  });

  it("знаменатель ноль — RangeError", () => {
    expect(() => scaleMoney("calculator.scale", byn(100), int("n", 1), int("d", 0), half)).toThrow(
      RangeError,
    );
  });
});

describe("ratioPercent: доля в процентах", () => {
  it("кафе 234,56 из 1 000,00 — 23 %", () => {
    expect(ratioPercent("calculator.percent", byn(23_456), byn(100_000), half).value).toBe(23);
  });

  it("половина процента округляется вверх: 1 из 200 — 1 %", () => {
    expect(ratioPercent("calculator.percent", byn(1), byn(200), half).value).toBe(1);
  });

  it("правило с шагом в рубль берётся с шагом в один процент", () => {
    const result = ratioPercent("calculator.percent", byn(23_456), byn(100_000), {
      rounding: "floor-ruble",
    });
    expect(result.value).toBe(23);
    expect(result.trace.note).toContain("step=1;");
  });

  it("целое не больше нуля и разные валюты — ошибка", () => {
    expect(() => ratioPercent("calculator.percent", byn(1), byn(0), half)).toThrow(RangeError);
    expect(() =>
      ratioPercent("calculator.percent", byn(1), node("w", Money.of(100, "USD")), half),
    ).toThrow(/валют/i);
  });
});

describe("dayCount", () => {
  it("лист трассы с числом дней и датами в пояснении", () => {
    const result = dayCount("calculator.days", 60, "2026-09-01 → 2026-10-31");
    expect(result.value).toBe(60);
    expect(result.trace.note).toBe("2026-09-01 → 2026-10-31");
  });
});
