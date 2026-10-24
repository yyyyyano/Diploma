// Помощники трассы над деньгами (ADR-0017, .claude/rules/calc.md): результат точный (BigInt внутри), трасса
// хранит аргументы в порядке формулы, выход за безопасный диапазон — ошибка, а не потеря копеек.
import { Money } from "@kosht/kernel";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { node, type Calc } from "./calc.ts";
import { avg, mul, sub, sum } from "./money-ops.ts";

const byn = (minor: number): Calc<Money> => node("test.amount", Money.of(minor, "BYN"));

describe("sum", () => {
  it("180 + 35 + 1 200 + 145 = 1 560 BYN, все слагаемые — в трассе", () => {
    const total = sum("fin.obligations", [byn(18000), byn(3500), byn(120000), byn(14500)]);
    expect(total.value).toEqual({ minor: 156000, currency: "BYN" });
    expect(total.trace).toMatchObject({ key: "fin.obligations", op: "sum", refs: [] });
    expect(total.trace.inputs.map((input) => input.value)).toEqual([
      { minor: 18000, currency: "BYN" },
      { minor: 3500, currency: "BYN" },
      { minor: 120000, currency: "BYN" },
      { minor: 14500, currency: "BYN" },
    ]);
  });

  it("отрицательные слагаемые (возвраты) уменьшают сумму", () => {
    expect(sum("fin.total", [byn(1000), byn(-250)]).value.minor).toBe(750);
  });

  it("сумма больше безопасного диапазона — ошибка, а не округлённое число", () => {
    expect(() => sum("fin.total", [byn(Number.MAX_SAFE_INTEGER), byn(1)])).toThrow(RangeError);
  });
});

describe("sub", () => {
  it("уменьшаемое — первый аргумент трассы, вычитаемые — следом", () => {
    const rest = sub("fin.rest", byn(1000), [byn(300), byn(200)]);
    expect(rest.value.minor).toBe(500);
    expect(rest.trace.op).toBe("sub");
    expect(rest.trace.inputs.map((input) => (input.value as Money).minor)).toEqual([
      1000, 300, 200,
    ]);
  });

  it("без вычитаемых результат равен уменьшаемому", () => {
    expect(sub("fin.rest", byn(1000), []).value.minor).toBe(1000);
  });

  it("результат может уйти в минус", () => {
    expect(sub("fin.rest", byn(100), [byn(250)]).value.minor).toBe(-150);
  });
});

describe("mul", () => {
  it("3 × 2,49 = 7,47 BYN: деньги на целое количество", () => {
    const line = mul("receipt.line", byn(249), node("receipt.quantity", 3));
    expect(line.value).toEqual({ minor: 747, currency: "BYN" });
    expect(line.trace).toMatchObject({ key: "receipt.line", op: "mul" });
    expect(line.trace.inputs.map((input) => input.value)).toEqual([
      { minor: 249, currency: "BYN" },
      3,
    ]);
  });

  it("произведение больше безопасного диапазона — ошибка", () => {
    expect(() => mul("x", byn(Number.MAX_SAFE_INTEGER), node("x.n", 2))).toThrow(RangeError);
  });
});

describe("avg", () => {
  it("средний доход за 3 месяца: (2 300 + 2 400 + 2 500) / 3 = 2 400 BYN", () => {
    const income = avg("fin.avgIncome", [byn(230000), byn(240000), byn(250000)], {
      rounding: "half-up-kopeck",
    });
    expect(income.value.minor).toBe(240000);
    expect(income.trace).toMatchObject({
      op: "avg",
      note: "rounding=half-up-kopeck step=1",
    });
    expect(income.trace.inputs).toHaveLength(3);
  });

  it("среднее 10 и 20 копеек с округлением до рубля вниз — 0", () => {
    expect(avg("x", [byn(10), byn(20)], { rounding: "floor-ruble" }).value.minor).toBe(0);
  });
});

describe("свойства (fast-check)", () => {
  const amount = fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 });

  it("порядок слагаемых не меняет сумму", () => {
    fc.assert(
      fc.property(
        fc
          .array(amount, { minLength: 1, maxLength: 20 })
          .chain((values) =>
            fc.tuple(
              fc.constant(values),
              fc.shuffledSubarray(values, { minLength: values.length, maxLength: values.length }),
            ),
          ),
        ([values, shuffled]) => {
          const [first, ...rest] = values.map(byn);
          const [firstShuffled, ...restShuffled] = shuffled.map(byn);
          if (first === undefined || firstShuffled === undefined) return;
          expect(sum("x", [firstShuffled, ...restShuffled]).value).toEqual(
            sum("x", [first, ...rest]).value,
          );
        },
      ),
    );
  });

  it("sub(sum(a, b), b) = a во всём безопасном диапазоне, включая его границы", () => {
    const pair = fc
      .oneof(
        fc.maxSafeInteger(),
        fc.constantFrom(Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0),
      )
      .chain((a) =>
        fc.tuple(
          fc.constant(a),
          fc.oneof(
            fc.integer({
              min: Math.max(Number.MIN_SAFE_INTEGER - a, Number.MIN_SAFE_INTEGER),
              max: Math.min(Number.MAX_SAFE_INTEGER - a, Number.MAX_SAFE_INTEGER),
            }),
            fc.constant(Number.MAX_SAFE_INTEGER - Math.max(a, 0)),
            fc.constant(Number.MIN_SAFE_INTEGER - Math.min(a, 0)),
          ),
        ),
      );
    fc.assert(
      fc.property(pair, ([a, b]) => {
        expect(sub("x", sum("x", [byn(a), byn(b)]), [byn(b)]).value.minor).toBe(a);
      }),
    );
  });

  it("сумма за пределами безопасного диапазона — всегда ошибка, а не неточное число", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), (b) => {
        expect(() => sum("x", [byn(Number.MAX_SAFE_INTEGER), byn(b)])).toThrow(RangeError);
      }),
    );
  });

  it("среднее лежит между наименьшим и наибольшим слагаемым при любом правиле округления", () => {
    const rules = ["half-up-kopeck", "half-even-kopeck", "floor-kopeck", "ceil-kopeck"] as const;
    fc.assert(
      fc.property(
        fc.array(amount, { minLength: 1, maxLength: 20 }),
        fc.constantFrom(...rules),
        (values, rounding) => {
          const [first, ...rest] = values.map(byn);
          if (first === undefined) return;
          const mean = avg("x", [first, ...rest], { rounding }).value.minor;
          expect(mean).toBeGreaterThanOrEqual(Math.min(...values));
          expect(mean).toBeLessThanOrEqual(Math.max(...values));
        },
      ),
    );
  });
});
