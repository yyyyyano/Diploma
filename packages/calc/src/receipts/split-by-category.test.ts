// RCPT-09, RCPT-07, TXN-10: разбивка итога чека по категориям позиций — сумма частей равна итогу.
import { Money } from "@kosht/kernel";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocate, splitByCategory } from "./split-by-category.ts";

const byn = (minor: number) => Money.of(minor, "BYN");
const line = (category: string, minor: number) => ({ category, total: byn(minor) });
const parts = (result: ReturnType<typeof splitByCategory>) =>
  result.map((part) => [part.category, part.amount.value.minor]);

describe("allocate", () => {
  it("1,00 поровну на троих: 34 + 33 + 33 — копейка достаётся первому", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("по весам 3 : 1 деление нацело", () => {
    expect(allocate(8, [6, 2])).toEqual([6, 2]);
  });

  it("при равных остатках раньше — первый; нулевые веса — нули", () => {
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
    expect(allocate(1, [2, 2])).toEqual([1, 0]);
  });

  it("свойство: сумма долей равна делимому, доля не больше веса, если делимое не больше суммы весов", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 8 }),
        fc.nat({ max: 10_000_000 }),
        (weights, raw) => {
          const amount = raw % (weights.reduce((a, b) => a + b, 0) + 1);
          const shares = allocate(amount, weights);
          expect(shares.reduce((a, b) => a + b, 0)).toBe(amount);
          shares.forEach((share, i) => expect(share).toBeLessThanOrEqual(weights[i] ?? 0));
        },
      ),
    );
  });
});

describe("RCPT-09: части итога по категориям", () => {
  it("итог равен сумме строк — части равны суммам категорий в порядке появления", () => {
    const result = splitByCategory({
      lines: [line("groceries", 1000), line("cafes", 500), line("groceries", 250)],
      total: byn(1750),
      remainderKey: "other",
    });
    expect(parts(result)).toEqual([
      ["groceries", 1250],
      ["cafes", 500],
    ]);
  });

  it("скидка на чек 1,00 делится пропорционально суммам: 30,00 и 10,00 → 29,25 и 9,75", () => {
    const result = splitByCategory({
      lines: [line("groceries", 3000), line("cafes", 1000)],
      total: byn(3900),
      remainderKey: "other",
    });
    expect(parts(result)).toEqual([
      ["groceries", 2925],
      ["cafes", 975],
    ]);
    expect(result[0]?.amount.trace.key).toBe("receipts.categorySplit");
  });

  it("часть чека не распознана — недостающее уходит в остаток («Прочее»), он помечен", () => {
    const result = splitByCategory({
      lines: [line("groceries", 3000)],
      total: byn(4730),
      remainderKey: "other",
    });
    expect(parts(result)).toEqual([
      ["groceries", 3000],
      ["other", 1730],
    ]);
    expect(result.map((part) => part.remainder)).toEqual([false, true]);
    expect(result[1]?.amount.trace.key).toBe("receipts.unrecognizedRemainder");
  });

  it("строки одной категории вперемешку складываются в одну часть на месте первого появления", () => {
    const result = splitByCategory({
      lines: [line("milk", 300), line("bread", 200), line("milk", 150)],
      total: byn(650),
      remainderKey: "other",
    });
    expect(parts(result)).toEqual([
      ["milk", 450],
      ["bread", 200],
    ]);
  });

  it("ни одной распознанной строки — весь итог уходит в остаток («Прочее»)", () => {
    const result = splitByCategory({ lines: [], total: byn(4730), remainderKey: "other" });
    expect(result.map((part) => [part.category, part.amount.value.minor, part.remainder])).toEqual([
      ["other", 4730, true],
    ]);
  });

  it("свойство: сумма частей равна итогу при любом итоге, а все части больше нуля", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            category: fc.constantFrom("a", "b", "c"),
            total: fc.integer({ min: 1, max: 100_000 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        fc.integer({ min: 1, max: 1_200_000 }),
        (lines, total) => {
          const result = splitByCategory({
            lines: lines.map((l) => line(l.category, l.total)),
            total: byn(total),
            remainderKey: "other",
          });
          expect(result.reduce((acc, part) => acc + part.amount.value.minor, 0)).toBe(total);
          expect(result.every((part) => part.amount.value.minor > 0)).toBe(true);
        },
      ),
    );
  });
});
