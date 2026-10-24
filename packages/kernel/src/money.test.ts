// Деньги — целые копейки (P1, .claude/rules/calc.md): дробных, «небезопасных» и безвалютных сумм не бывает,
// а операция над разными валютами без явного пересчёта — ошибка.
import { describe, expect, it } from "vitest";
import { CurrencyMismatchError, Money } from "./money.ts";

describe("Money.of", () => {
  it("1 234,56 BYN хранится как 123456 копеек", () => {
    expect(Money.of(123456, "BYN")).toEqual({ minor: 123456, currency: "BYN" });
  });

  it("отрицательная сумма (возврат, расход) допустима", () => {
    expect(Money.of(-18000, "BYN")).toEqual({ minor: -18000, currency: "BYN" });
  });

  it("12,5 копейки — ошибка: дробных копеек не бывает", () => {
    expect(() => Money.of(12.5, "BYN")).toThrow(RangeError);
  });

  it("сумма за пределами безопасного диапазона целых — ошибка, а не потеря точности", () => {
    expect(() => Money.of(Number.MAX_SAFE_INTEGER + 1, "BYN")).toThrow(RangeError);
    expect(() => Money.of(Number.MIN_SAFE_INTEGER - 1, "BYN")).toThrow(RangeError);
  });

  it("границы безопасного диапазона — ещё деньги", () => {
    expect(Money.of(Number.MAX_SAFE_INTEGER, "BYN").minor).toBe(Number.MAX_SAFE_INTEGER);
    expect(Money.of(Number.MIN_SAFE_INTEGER, "BYN").minor).toBe(Number.MIN_SAFE_INTEGER);
  });

  it("NaN и бесконечность — не деньги", () => {
    expect(() => Money.of(Number.NaN, "BYN")).toThrow(RangeError);
    expect(() => Money.of(Number.POSITIVE_INFINITY, "BYN")).toThrow(RangeError);
  });

  it.each(["byn", "BY", "BYNN", "Б Y", ""])(
    "валюта «%s» — не код из трёх заглавных букв",
    (code) => {
      expect(() => Money.of(100, code)).toThrow(RangeError);
    },
  );
});

describe("Money.schema", () => {
  it("разбирает деньги «с провода»", () => {
    expect(Money.schema.parse({ minor: 840_00, currency: "BYN" })).toEqual({
      minor: 84000,
      currency: "BYN",
    });
  });

  it.each([
    { minor: 1.5, currency: "BYN" },
    { minor: Number.MAX_SAFE_INTEGER + 1, currency: "BYN" },
    { minor: 100, currency: "byn" },
    { minor: "100", currency: "BYN" },
  ])("не пропускает %o", (value) => {
    expect(Money.schema.safeParse(value).success).toBe(false);
  });
});

describe("Money.sameCurrency", () => {
  it("общая валюта сумм — её код", () => {
    expect(Money.sameCurrency([Money.of(1, "BYN"), Money.of(2, "BYN")])).toBe("BYN");
  });

  it("BYN и USD вместе — ошибка с обеими валютами в сообщении", () => {
    const mixed = [Money.of(1, "BYN"), Money.of(2, "USD")];
    expect(() => Money.sameCurrency(mixed)).toThrow(CurrencyMismatchError);
    expect(() => Money.sameCurrency(mixed)).toThrow("BYN и USD");
  });

  it("пустой список — ошибка: валюту не из чего взять", () => {
    expect(() => Money.sameCurrency([])).toThrow(RangeError);
  });
});
