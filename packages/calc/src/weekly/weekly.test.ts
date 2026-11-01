// WEEK-02: среднее по прошлым неделям и отклонение этой недели в процентах — пример SPEC («312 BYN — на 18 % больше обычного»).
import { Money } from "@kosht/kernel";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { node } from "../calc.ts";
import { deviationPercent, weeklyAverage, weeksNode } from "./weekly.ts";

const money = (key: string, minor: number) => node(key, Money.of(minor, "BYN"));

describe("weeklyAverage", () => {
  it("8 недель на 2 118,00 BYN → 264,75 в неделю", () => {
    const average = weeklyAverage(money("transactions.expense", 211_800), weeksNode(8));
    expect(average.value).toEqual(Money.of(26_475, "BYN"));
    expect(average.trace.key).toBe("weekly.average");
    expect(average.trace.inputs.map((input) => input.key)).toEqual([
      "transactions.expense",
      "weekly.weeks",
    ]);
  });

  it("округляет до копейки от нуля: 100,01 ÷ 8 = 12,50125 → 12,50; 0,05 ÷ 2 → 0,03", () => {
    expect(weeklyAverage(money("a", 10_001), weeksNode(8)).value.minor).toBe(1250);
    expect(weeklyAverage(money("a", 5), weeksNode(2)).value.minor).toBe(3);
  });

  it("недель меньше одной или не целое — RangeError", () => {
    expect(() => weeklyAverage(money("a", 100), weeksNode(0))).toThrow(RangeError);
    expect(() => weeklyAverage(money("a", 100), { ...weeksNode(1), value: 1.5 })).toThrow(
      RangeError,
    );
  });
});

describe("deviationPercent", () => {
  it("пример SPEC: 312 против обычных 264,41 — на 18 % больше", () => {
    const result = deviationPercent(money("w", 31_200), money("a", 26_441));
    expect(result?.value).toBe(18);
    expect(result?.trace.key).toBe("weekly.deviation");
  });

  it("меньше обычного — отрицательный процент", () => {
    expect(deviationPercent(money("w", 7500), money("a", 10_000))?.value).toBe(-25);
  });

  it("как обычно — ноль; половина процента округляется от нуля", () => {
    expect(deviationPercent(money("w", 10_000), money("a", 10_000))?.value).toBe(0);
    expect(deviationPercent(money("w", 10_050), money("a", 10_000))?.value).toBe(1);
    expect(deviationPercent(money("w", 9950), money("a", 10_000))?.value).toBe(-1);
  });

  it("среднего нет или оно нулевое — сравнения нет, а не бесконечность", () => {
    expect(deviationPercent(money("w", 100), money("a", 0))).toBeNull();
  });

  it("свойство: процент растёт вместе с тратами недели", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (average, a, b) => {
          const low = deviationPercent(money("w", Math.min(a, b)), money("a", average));
          const high = deviationPercent(money("w", Math.max(a, b)), money("a", average));
          expect(high?.value ?? 0).toBeGreaterThanOrEqual(low?.value ?? 0);
        },
      ),
    );
  });
});
