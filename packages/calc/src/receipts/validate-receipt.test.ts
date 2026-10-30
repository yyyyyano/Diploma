// RCPT-05, RCPT-06: арифметический валидатор чека — строка (количество × цена − скидка = сумма строки) и итог
// (сумма строк − скидки на чек = итог), допуск на округление ±0,01; расхождение называет строку.
import { CurrencyMismatchError, Money } from "@kosht/kernel";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validateReceipt, type ReceiptInput, type ReceiptLineInput } from "./validate-receipt.ts";

const byn = (minor: number) => Money.of(minor, "BYN");

/** Строка чека: количество в штуках (или тысячных долях, если задано `milli`), цена, скидка и сумма в копейках. */
function line(
  quantity: number,
  priceMinor: number,
  totalMinor: number,
  discountMinor = 0,
  milli = false,
): ReceiptLineInput {
  return {
    quantityMilli: milli ? quantity : quantity * 1000,
    unitPrice: byn(priceMinor),
    discount: byn(discountMinor),
    lineTotal: byn(totalMinor),
  };
}

function receipt(lines: ReceiptLineInput[], totalMinor: number, discountMinor = 0): ReceiptInput {
  return {
    lines,
    receiptDiscount: byn(discountMinor),
    total: byn(totalMinor),
    tolerance: byn(1),
  };
}

describe("RCPT-05: строки чека", () => {
  it("чек 3 × 2,49 = 8,47 не сходится и называет строку 2", () => {
    const result = validateReceipt(
      receipt([line(1, 1_099, 1_099), line(3, 249, 847), line(1, 500, 500)], 2_446),
    );
    expect(result.ok).toBe(false);
    expect(result.disputedLines).toEqual([2]);
    expect(result.lines[1]?.expected.value).toEqual(byn(747));
    expect(result.lines[1]?.difference.value).toEqual(byn(100));
  });

  it("2 × 1,99 − скидка 0,40 = 3,58 сходится", () => {
    const result = validateReceipt(receipt([line(2, 199, 358, 40)], 358));
    expect(result.ok).toBe(true);
    expect(result.disputedLines).toEqual([]);
  });

  it("весовой товар 0,345 кг × 12,99 = 4,48 (4,48155 до копейки) сходится", () => {
    const result = validateReceipt(receipt([line(345, 1_299, 448, 0, true)], 448));
    expect(result.ok).toBe(true);
    expect(result.lines[0]?.expected.value).toEqual(byn(448));
  });

  it("копейка на округлении кассы — в допуске: сумма строки 4,49 против 4,48 сходится", () => {
    const result = validateReceipt(receipt([line(345, 1_299, 449, 0, true)], 449));
    expect(result.ok).toBe(true);
  });

  it("две копейки — уже расхождение, а допуск настраивается", () => {
    const input = receipt([line(345, 1_299, 450, 0, true)], 450);
    expect(validateReceipt(input).disputedLines).toEqual([1]);
    expect(validateReceipt({ ...input, tolerance: byn(2) }).ok).toBe(true);
  });

  it("сумма строки меньше расчётной тоже расхождение: 2 × 5,00 = 9,00", () => {
    const result = validateReceipt(receipt([line(2, 500, 900)], 900));
    expect(result.disputedLines).toEqual([1]);
    expect(result.lines[0]?.difference.value).toEqual(byn(-100));
  });

  it("несколько спорных строк называются по порядку чека", () => {
    const result = validateReceipt(
      receipt([line(1, 100, 100), line(2, 100, 300), line(1, 100, 100), line(2, 100, 50)], 550),
    );
    expect(result.disputedLines).toEqual([2, 4]);
  });
});

describe("RCPT-05: итог чека", () => {
  it("сумма строк 25,00 − скидка на чек 2,00 = итог 23,00 сходится", () => {
    const result = validateReceipt(
      receipt([line(1, 1_000, 1_000), line(3, 500, 1_500)], 2_300, 200),
    );
    expect(result.ok).toBe(true);
    expect(result.total.expected.value).toEqual(byn(2_300));
  });

  it("итог 24,00 при сумме строк 25,00 — расхождение итога, строки целы", () => {
    const result = validateReceipt(receipt([line(1, 1_000, 1_000), line(3, 500, 1_500)], 2_400));
    expect(result.ok).toBe(false);
    expect(result.disputedLines).toEqual([]);
    expect(result.total.ok).toBe(false);
    expect(result.total.difference.value).toEqual(byn(-100));
  });

  it("итог в пределах ±0,01 от суммы строк сходится", () => {
    expect(validateReceipt(receipt([line(1, 1_000, 1_000)], 1_001)).ok).toBe(true);
    expect(validateReceipt(receipt([line(1, 1_000, 1_000)], 999)).ok).toBe(true);
    expect(validateReceipt(receipt([line(1, 1_000, 1_000)], 1_002)).ok).toBe(false);
  });

  it("ошибка в одной строке тянет за собой и итог: расхождение видно в обоих местах", () => {
    const result = validateReceipt(receipt([line(1, 1_099, 1_099), line(3, 249, 847)], 1_846));
    expect(result.disputedLines).toEqual([2]);
    expect(result.total.ok).toBe(false);
  });

  it("чек без строк: итог должен быть нулевым", () => {
    expect(validateReceipt(receipt([], 0)).ok).toBe(true);
    expect(validateReceipt(receipt([], 500)).total.ok).toBe(false);
  });
});

describe("EXPL-01: трасса проверки", () => {
  it("расхождение строки — разница сумм, расчётная сумма — произведение за вычетом скидки", () => {
    const result = validateReceipt(receipt([line(3, 249, 847, 10)], 837));
    const difference = result.lines[0]?.difference.trace;
    expect(difference).toMatchObject({ key: "receipts.lineDifference", op: "sub" });
    const [actual, expected] = difference?.inputs ?? [];
    expect(actual?.key).toBe("receipts.lineTotal");
    expect(expected).toMatchObject({ key: "receipts.lineExpected", op: "sub" });
    expect(expected?.inputs.map((input) => input.key)).toEqual([
      "receipts.lineGross",
      "receipts.lineDiscount",
    ]);
    expect(expected?.inputs[0]?.inputs.map((input) => input.key)).toEqual([
      "receipts.unitPrice",
      "receipts.quantity",
    ]);
  });

  it("расхождение итога — итог минус (сумма строк − скидки на чек), слагаемые в порядке чека", () => {
    const result = validateReceipt(receipt([line(1, 100, 100), line(1, 200, 200)], 250, 50));
    const difference = result.total.difference.trace;
    expect(difference).toMatchObject({ key: "receipts.totalDifference", op: "sub" });
    const [actual, expected] = difference.inputs;
    expect(actual?.key).toBe("receipts.total");
    expect(expected).toMatchObject({ key: "receipts.expectedTotal", op: "sub" });
    expect(expected?.inputs[0]).toMatchObject({ key: "receipts.linesSum", op: "sum" });
    expect(expected?.inputs[0]?.inputs.map((input) => (input.value as Money).minor)).toEqual([
      100, 200,
    ]);
    expect(expected?.inputs[1]?.key).toBe("receipts.receiptDiscount");
  });
});

describe("входные данные", () => {
  it("деньги в разных валютах — ошибка программы, а не расхождение", () => {
    expect(() =>
      validateReceipt({
        lines: [line(1, 100, 100)],
        receiptDiscount: Money.of(0, "USD"),
        total: byn(100),
        tolerance: byn(1),
      }),
    ).toThrow(CurrencyMismatchError);
  });

  it("количество — целое число тысячных, дробное — ошибка", () => {
    expect(() =>
      validateReceipt(receipt([{ ...line(1, 100, 100), quantityMilli: 1.5 }], 100)),
    ).toThrow(RangeError);
  });
});

describe("свойства (fast-check)", () => {
  const consistent = fc
    .record({
      quantityMilli: fc.integer({ min: 1, max: 50_000 }),
      priceMinor: fc.integer({ min: 1, max: 5_000_000 }),
    })
    .chain(({ quantityMilli, priceMinor }) => {
      const gross = Math.round((quantityMilli * priceMinor) / 1000);
      return fc.record({
        quantityMilli: fc.constant(quantityMilli),
        priceMinor: fc.constant(priceMinor),
        discountMinor: fc.integer({ min: 0, max: Math.max(0, gross) }),
      });
    });

  it("строка, посчитанная по формуле, всегда сходится, а сдвиг больше допуска — нет", () => {
    fc.assert(
      fc.property(consistent, fc.integer({ min: 2, max: 10_000 }), (c, shift) => {
        const exact = validateReceipt(
          receipt([line(c.quantityMilli, c.priceMinor, 0, c.discountMinor, true)], 0),
        ).lines[0]?.expected.value.minor;
        if (exact === undefined) throw new Error("нет расчётной суммы");
        const ok = validateReceipt(
          receipt([line(c.quantityMilli, c.priceMinor, exact, c.discountMinor, true)], exact),
        );
        expect(ok.ok).toBe(true);
        const bad = validateReceipt(
          receipt(
            [line(c.quantityMilli, c.priceMinor, exact + shift, c.discountMinor, true)],
            exact + shift,
          ),
        );
        expect(bad.disputedLines).toEqual([1]);
      }),
    );
  });

  it("количество «1 штука» не меняет цену: расчётная сумма равна цене минус скидка", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9_000_000 }), (price) => {
        const result = validateReceipt(receipt([line(1, price, price)], price));
        expect(result.lines[0]?.expected.value.minor).toBe(price);
      }),
    );
  });
});
