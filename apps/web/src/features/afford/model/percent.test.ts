// AFF-05: разбор ставки и срока, названных человеком, в целые числа для сервера.
import { describe, expect, it } from "vitest";
import { parseMonths, parseRateBp } from "./percent.ts";

describe("parseRateBp", () => {
  it.each([
    ["14", 1400],
    ["14,5", 1450],
    ["14.05", 1405],
    ["0", 0],
    ["100", 10_000],
    [" 7 ", 700],
  ])("«%s» → %d сотых процента", (text, bp) => {
    expect(parseRateBp(text)).toBe(bp);
  });

  it.each(["", "abc", "14,555", "101", "100,01", "-5", "1 4", ","])("«%s» — не ставка", (text) => {
    expect(parseRateBp(text)).toBeUndefined();
  });
});

describe("parseMonths", () => {
  it.each([
    ["1", 1],
    ["36", 36],
    ["600", 600],
  ])("«%s» → %d", (text, months) => {
    expect(parseMonths(text)).toBe(months);
  });

  it.each(["", "0", "601", "12,5", "-3", "abc"])("«%s» — не срок", (text) => {
    expect(parseMonths(text)).toBeUndefined();
  });
});
