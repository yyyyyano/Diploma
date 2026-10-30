// BUD-01, BUD-02, BUD-03: процент лимита по календарному месяцу и пороги 80 / 100 %.
import { Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { node } from "../calc.ts";
import { limitPercent, reachedThresholds } from "./limits.ts";

const byn = (minor: number) => Money.of(minor, "BYN");
const spent = (minor: number) => node("transactions.categoryTotal", byn(minor));

describe("BUD-02: процент лимита", () => {
  it("лимит 200, траты 160 → 80 %, основания — траты и лимит", () => {
    const result = limitPercent(spent(16_000), byn(20_000));
    expect(result.value).toBe(80);
    expect(result.trace).toMatchObject({
      key: "budgets.limitPercent",
      op: "round",
      inputs: [{ key: "transactions.categoryTotal" }, { key: "budgets.limit", value: byn(20_000) }],
    });
  });

  it("траты 205 при лимите 200 → 102 %: больше ста тоже процент", () => {
    expect(limitPercent(spent(20_500), byn(20_000)).value).toBe(102);
  });

  it("процент округляется вниз: 159,99 из 200 — это 79 %, а не 80", () => {
    const result = limitPercent(spent(15_999), byn(20_000));
    expect(result.value).toBe(79);
    expect(result.trace.note).toBe("rounding=floor step=1; сумма × 100 ÷ лимит");
  });

  it("возвратов больше покупок: отрицательные траты — 0 %, а не минус", () => {
    expect(limitPercent(spent(-500), byn(20_000)).value).toBe(0);
  });

  it("лимит ноль — ошибка программы: делить не на что", () => {
    expect(() => limitPercent(spent(100), byn(0))).toThrow(RangeError);
  });
});

describe("BUD-03: пороги", () => {
  const thresholds = [80, 100] as const;

  it("79 % — порогов нет; 80 % — один; 100 % — оба", () => {
    expect(reachedThresholds(79, thresholds)).toEqual([]);
    expect(reachedThresholds(80, thresholds)).toEqual([80]);
    expect(reachedThresholds(99, thresholds)).toEqual([80]);
    expect(reachedThresholds(100, thresholds)).toEqual([80, 100]);
  });

  it("траты сразу до 112 % — оба порога разом (импорт перепрыгнул 80)", () => {
    expect(reachedThresholds(112, thresholds)).toEqual([80, 100]);
  });
});
