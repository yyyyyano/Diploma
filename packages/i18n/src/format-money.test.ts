// DES-17: «1 234,56 BYN» — неразрывный пробел (U+00A0) между разрядами и перед кодом, запятая перед копейками,
// минус — U+2212. Каждый символ проверяется кодом: обычный пробел или дефис глазом не отличить.
import { Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { formatMoney, formatMoneyParts } from "./format-money.ts";

// Через коды, а не литералами: форматтер заменяет экранированные символы невидимыми, их не видно в тексте.
const NBSP = String.fromCharCode(0x00a0);
const MINUS = String.fromCharCode(0x2212);

/** Коды символов строки (все — из BMP): так тест видит разницу между U+00A0 и U+0020, U+2212 и U+002D. */
function codes(text: string): number[] {
  return Array.from({ length: text.length }, (_, index) => text.charCodeAt(index));
}

function byn(minor: number): Money {
  return Money.of(minor, "BYN");
}

describe("DES-17: formatMoney", () => {
  it.each([
    [123_456, `1${NBSP}234,56${NBSP}BYN`],
    [-84_000, `${MINUS}840,00${NBSP}BYN`],
    [-5, `${MINUS}0,05${NBSP}BYN`],
    [0, `0,00${NBSP}BYN`],
    [100_000_000, `1${NBSP}000${NBSP}000,00${NBSP}BYN`],
    [Number.MAX_SAFE_INTEGER, `90${NBSP}071${NBSP}992${NBSP}547${NBSP}409,91${NBSP}BYN`],
  ])("%i копеек — каждый символ совпадает по коду", (minor, expected) => {
    expect(codes(formatMoney(byn(minor)))).toEqual(codes(expected));
  });

  it("1 234,56 BYN: символы по кодам — цифра, U+00A0, цифры, запятая, цифры, U+00A0, код валюты", () => {
    expect(codes(formatMoney(byn(123_456)))).toEqual([
      0x31, 0xa0, 0x32, 0x33, 0x34, 0x2c, 0x35, 0x36, 0xa0, 0x42, 0x59, 0x4e,
    ]);
  });

  it("−840,00 BYN начинается с минуса U+2212, а не с дефиса", () => {
    expect(formatMoney(byn(-84_000)).codePointAt(0)).toBe(0x2212);
  });

  it("Number.MAX_SAFE_INTEGER — без потери цифр (BigInt, а не деление в float)", () => {
    expect(formatMoney(byn(Number.MAX_SAFE_INTEGER)).replaceAll(NBSP, "")).toBe(
      "90071992547409,91BYN",
    );
  });

  it("самая маленькая сумма тоже без потери: −MAX_SAFE_INTEGER", () => {
    expect(formatMoney(byn(-Number.MAX_SAFE_INTEGER))).toBe(
      `${MINUS}90${NBSP}071${NBSP}992${NBSP}547${NBSP}409,91${NBSP}BYN`,
    );
  });

  it.each([
    [1, `0,01${NBSP}BYN`],
    [99, `0,99${NBSP}BYN`],
    [100, `1,00${NBSP}BYN`],
    [99_999, `999,99${NBSP}BYN`],
    [100_000, `1${NBSP}000,00${NBSP}BYN`],
  ])("%i копеек — разряды и копейки на границах", (minor, expected) => {
    expect(formatMoney(byn(minor))).toBe(expected);
  });

  it("−0 — без минуса", () => {
    expect(formatMoney({ minor: -0, currency: "BYN" })).toBe(`0,00${NBSP}BYN`);
  });

  it("код валюты пишется как есть, без символа: 12,00 USD", () => {
    expect(formatMoney(Money.of(1200, "USD"))).toBe(`12,00${NBSP}USD`);
  });

  it.each([1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "%s — не целые копейки: RangeError, а не неверная строка",
    (minor) => {
      expect(() => formatMoney({ minor, currency: "BYN" })).toThrow(RangeError);
    },
  );

  it("неверный код валюты — RangeError", () => {
    expect(() => formatMoney({ minor: 100, currency: "руб" })).toThrow(RangeError);
  });
});

describe("DES-17: formatMoneyParts — сумма по частям для вёрстки (валюта мельче, знак — по смыслу)", () => {
  it("1 234,56 BYN → знака нет, сумма с U+00A0 между разрядами, код отдельно", () => {
    expect(formatMoneyParts(byn(123_456))).toEqual({
      negative: false,
      amount: `1${NBSP}234,56`,
      currency: "BYN",
    });
  });

  it("−840,00 BYN → признак минуса отдельно, сумма без знака", () => {
    expect(formatMoneyParts(byn(-84_000))).toEqual({
      negative: true,
      amount: "840,00",
      currency: "BYN",
    });
  });

  it("−0 — не отрицательная", () => {
    expect(formatMoneyParts({ minor: -0, currency: "BYN" }).negative).toBe(false);
  });

  it("части собираются в ту же строку, что formatMoney", () => {
    for (const minor of [0, 5, -5, 123_456, -Number.MAX_SAFE_INTEGER]) {
      const parts = formatMoneyParts(byn(minor));
      expect(`${parts.negative ? MINUS : ""}${parts.amount}${NBSP}${parts.currency}`).toBe(
        formatMoney(byn(minor)),
      );
    }
  });

  it("дробные копейки — RangeError, как у formatMoney", () => {
    expect(() => formatMoneyParts({ minor: 1.5, currency: "BYN" })).toThrow(RangeError);
  });
});
