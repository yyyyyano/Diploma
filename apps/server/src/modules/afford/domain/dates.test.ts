// AFF-03: сдвиг на месяцы и повторы ожидаемого дохода.
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { addMonths, monthlyDays } from "./dates.ts";

const day = (text: string) => LocalDate.parse(text);

describe("addMonths", () => {
  it.each([
    ["2026-10-28", 9, "2027-07-28"],
    ["2026-10-28", 0, "2026-10-28"],
    ["2026-12-15", 1, "2027-01-15"],
    ["2027-01-31", 1, "2027-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2026-10-31", 5, "2027-03-31"],
    ["2026-10-31", 12, "2027-10-31"],
  ])("%s + %d мес. = %s", (from, months, expected) => {
    expect(addMonths(day(from), months)).toBe(expected);
  });

  it("отрицательное и дробное число месяцев — RangeError", () => {
    expect(() => addMonths(day("2026-10-28"), -1)).toThrow(RangeError);
    expect(() => addMonths(day("2026-10-28"), 1.5)).toThrow(RangeError);
  });
});

describe("monthlyDays", () => {
  it("25 октября на три месяца вперёд — 25.10, 25.11, 25.12, 25.01", () => {
    expect(monthlyDays(day("2026-10-25"), day("2027-01-26"))).toEqual([
      "2026-10-25",
      "2026-11-25",
      "2026-12-25",
      "2027-01-25",
    ]);
  });

  it("31-е число: короткий месяц — последний день, дальше снова 31-е", () => {
    expect(monthlyDays(day("2027-01-31"), day("2027-03-31"))).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
  });

  it("первый день позже границы — пусто", () => {
    expect(monthlyDays(day("2027-02-01"), day("2027-01-01"))).toEqual([]);
  });
});
