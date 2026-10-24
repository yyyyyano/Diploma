// Округление (.claude/rules/calc.md, уточнение критика T-003): половина «от нуля» (half-up), банковское — к чётному
// (half-even), вниз (floor) и вверх (ceil); шаг — копейка или рубль; правило и шаг пишутся в трассу. Ставка — целые
// базисные пункты (1300 = 13 %), считается на BigInt.
import { Money } from "@kosht/kernel";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { node, type Calc } from "./calc.ts";
import { mulRate, round } from "./money-ops.ts";
import type { RoundingRule } from "./rounding.ts";

const byn = (minor: number): Calc<Money> => node("test.amount", Money.of(minor, "BYN"));
const halfRate = node("test.rate", 5000); // 50 %: 1 коп → 0,5 коп, 3 коп → 1,5 коп

/** Сколько копеек даёт x копеек × 50 % при правиле округления. */
const half = (minor: number, rounding: RoundingRule): number =>
  mulRate("test.half", byn(minor), halfRate, { rounding }).value.minor;

describe("половины копейки: −0,5 / +0,5 / −1,5 / +1,5", () => {
  it("half-up — от нуля, симметрично: −1 / 1 / −2 / 2", () => {
    expect([-1, 1, -3, 3].map((x) => half(x, "half-up-kopeck"))).toEqual([-1, 1, -2, 2]);
  });

  it("half-even (банковское) — к чётному: 0 / 0 / −2 / 2", () => {
    expect([-1, 1, -3, 3].map((x) => half(x, "half-even-kopeck"))).toEqual([0, 0, -2, 2]);
  });

  it("floor — вниз, к минус бесконечности: −1 / 0 / −2 / 1", () => {
    expect([-1, 1, -3, 3].map((x) => half(x, "floor-kopeck"))).toEqual([-1, 0, -2, 1]);
  });

  it("ceil — вверх, к плюс бесконечности: 0 / 1 / −1 / 2", () => {
    expect([-1, 1, -3, 3].map((x) => half(x, "ceil-kopeck"))).toEqual([0, 1, -1, 2]);
  });

  it("банковское −0,5 даёт ровно 0, а не −0", () => {
    expect(Object.is(half(-1, "half-even-kopeck"), 0)).toBe(true);
  });
});

describe("половины рубля: round до шага 100 копеек", () => {
  const toRuble = (minor: number, rounding: RoundingRule): number =>
    round("test.round", byn(minor), { rounding }).value.minor;

  it("half-up: −0,50 / 0,50 / −1,50 / 1,50 BYN → −1 / 1 / −2 / 2 BYN", () => {
    expect([-50, 50, -150, 150].map((x) => toRuble(x, "half-up-ruble"))).toEqual([
      -100, 100, -200, 200,
    ]);
  });

  it("half-even: → 0 / 0 / −2 / 2 BYN", () => {
    expect([-50, 50, -150, 150].map((x) => toRuble(x, "half-even-ruble"))).toEqual([
      0, 0, -200, 200,
    ]);
  });

  it("floor: → −1 / 0 / −2 / 1 BYN", () => {
    expect([-50, 50, -150, 150].map((x) => toRuble(x, "floor-ruble"))).toEqual([
      -100, 0, -200, 100,
    ]);
  });

  it("ceil: → 0 / 1 / −1 / 2 BYN", () => {
    expect([-50, 50, -150, 150].map((x) => toRuble(x, "ceil-ruble"))).toEqual([0, 100, -100, 200]);
  });

  it("правило и шаг — в трассе", () => {
    expect(round("budget.monthly", byn(33_950), { rounding: "ceil-ruble" }).trace).toMatchObject({
      key: "budget.monthly",
      op: "round",
      value: { minor: 34_000, currency: "BYN" },
      note: "rounding=ceil-ruble step=100",
    });
  });

  it("до копейки целые копейки не меняются", () => {
    expect(toRuble(12_345, "half-up-kopeck")).toBe(12_345);
  });
});

describe("mulRate — деньги × ставка в базисных пунктах", () => {
  it("TAX-07, пример 1: 2 000 BYN × 13 % = 260 BYN, ставка и правило — в трассе", () => {
    const saving = mulRate("tax.saving", byn(200_000), node("tax.rate", 1300), {
      rounding: "half-up-kopeck",
    });
    expect(saving.value).toEqual({ minor: 26_000, currency: "BYN" });
    expect(saving.trace).toMatchObject({
      key: "tax.saving",
      op: "mul",
      note: "rounding=half-up-kopeck step=1",
    });
    expect(saving.trace.inputs.map((input) => input.value)).toEqual([
      { minor: 200_000, currency: "BYN" },
      1300,
    ]);
  });

  it("большая сумма × ставка считается точно (BigInt), без потери копеек", () => {
    const big = Number.MAX_SAFE_INTEGER - 1; // 9 007 199 254 740 990 × 50 % = 4 503 599 627 370 495
    expect(half(big, "half-up-kopeck")).toBe(4_503_599_627_370_495);
  });

  it("результат вне безопасного диапазона — ошибка", () => {
    expect(() =>
      mulRate("x", byn(Number.MAX_SAFE_INTEGER), node("x.rate", 20_000), {
        rounding: "half-up-kopeck",
      }),
    ).toThrow(RangeError);
  });
});

describe("свойства round (fast-check)", () => {
  const rules = [
    "half-up-kopeck",
    "half-even-kopeck",
    "floor-kopeck",
    "ceil-kopeck",
    "half-up-ruble",
    "half-even-ruble",
    "floor-ruble",
    "ceil-ruble",
  ] as const satisfies readonly RoundingRule[];
  const amount = fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 });
  const rounded = (minor: number, rounding: RoundingRule) =>
    round("x", byn(minor), { rounding }).value.minor;

  it("идемпотентность: повторное округление ничего не меняет", () => {
    fc.assert(
      fc.property(amount, fc.constantFrom(...rules), (minor, rule) => {
        const once = rounded(minor, rule);
        expect(rounded(once, rule)).toBe(once);
      }),
    );
  });

  it("монотонность: x ≤ y ⇒ round(x) ≤ round(y)", () => {
    fc.assert(
      fc.property(amount, amount, fc.constantFrom(...rules), (a, b, rule) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(rounded(low, rule)).toBeLessThanOrEqual(rounded(high, rule));
      }),
    );
  });

  it("|round(x) − x| ≤ шаг / 2 для half-up и half-even", () => {
    const halfRules = rules.filter((rule) => rule.startsWith("half-"));
    fc.assert(
      fc.property(amount, fc.constantFrom(...halfRules), (minor, rule) => {
        const step = rule.endsWith("-ruble") ? 100 : 1;
        expect(Math.abs(rounded(minor, rule) - minor)).toBeLessThanOrEqual(step / 2);
      }),
    );
  });

  it("floor не выше x и ceil не ниже x, оба ближе шага", () => {
    fc.assert(
      fc.property(amount, fc.constantFrom(100, 1), (minor, step) => {
        const unit = step === 100 ? "ruble" : "kopeck";
        const down = rounded(minor, `floor-${unit}`);
        const up = rounded(minor, `ceil-${unit}`);
        expect([minor - down < step, down <= minor, up - minor < step, up >= minor]).toEqual([
          true,
          true,
          true,
          true,
        ]);
      }),
    );
  });

  it("результат кратен шагу", () => {
    fc.assert(
      fc.property(amount, fc.constantFrom(...rules), (minor, rule) => {
        const step = rule.endsWith("-ruble") ? 100 : 1;
        expect(Math.abs(rounded(minor, rule) % step)).toBe(0);
      }),
    );
  });
});
