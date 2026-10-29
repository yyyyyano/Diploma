// STMT-04: суммы и даты в форматах разных банков.
import { describe, expect, it } from "vitest";
import { detectDateOrder, detectDecimal, parseAmount, parseDate, parseTime } from "./values.ts";

describe("STMT-04: суммы", () => {
  it.each([
    ["1 234,56", ",", 123_456],
    ["1 234,56", ",", 123_456],
    ["1,234.56", ".", 123_456],
    ["1234.56", ".", 123_456],
    ["-12,50", ",", -1_250],
    ["−12,50", ",", -1_250],
    ["(12,50)", ",", -1_250],
    ["12,50-", ",", -1_250],
    ["+7,5", ",", 750],
    ["5", ",", 500],
    ["12,50 BYN", ",", 1_250],
    ["$12.50", ".", 1_250],
    ["0,05", ",", 5],
  ] as const)("«%s» при дробной части «%s» — %i копеек", (text, decimal, minor) => {
    expect(parseAmount(text, decimal)).toBe(minor);
  });

  it.each([["" as string], ["abc"], ["12,345"], ["1.2.3"], ["--5"]])("«%s» — не сумма", (text) => {
    expect(parseAmount(text, ",")).toBeUndefined();
  });

  it("десятичный разделитель колонки — по образцам: запятая, точка, у целых чисел — неизвестен", () => {
    expect(detectDecimal(["1 234,56", "12,5", "7"])).toBe(",");
    expect(detectDecimal(["1,234.56", "12.50"])).toBe(".");
    expect(detectDecimal(["100", "2 000"])).toBeUndefined();
    // «1.234» — разряды, а не копейки.
    expect(detectDecimal(["1.234", "2.500"])).toBeUndefined();
  });
});

describe("STMT-04: даты", () => {
  it.each([
    ["15.09.2026", "dmy", "2026-09-15"],
    ["15.09.26", "dmy", "2026-09-15"],
    ["15/09/2026", "dmy", "2026-09-15"],
    ["09/15/2026", "mdy", "2026-09-15"],
    ["15-09-2026", "dmy", "2026-09-15"],
    ["2026-09-15", "dmy", "2026-09-15"],
    ["2026-09-15T10:30:00", "dmy", "2026-09-15"],
    ["1.9.2026", "dmy", "2026-09-01"],
  ] as const)("«%s» (%s) — %s", (text, order, iso) => {
    expect(parseDate(text, order)?.date).toBe(iso);
  });

  it("дата и время в одной ячейке разделяются", () => {
    expect(parseDate("15.09.2026 08:05", "dmy")).toEqual({ date: "2026-09-15", time: "08:05" });
    expect(parseDate("2026-09-15T10:30:00", "dmy")).toEqual({ date: "2026-09-15", time: "10:30" });
  });

  it("31.02.2026, текст после даты и не дата — undefined", () => {
    expect(parseDate("31.02.2026", "dmy")).toBeUndefined();
    expect(parseDate("29.02.2028", "dmy")?.date).toBe("2028-02-29");
    expect(parseDate("15.09.2026 перевод", "dmy")).toBeUndefined();
    expect(parseDate("Дата", "dmy")).toBeUndefined();
  });

  it("порядок даты: число больше 12 на втором месте — месяц первым; без таких — день первым", () => {
    expect(detectDateOrder(["09/15/2026", "10/01/2026"])).toBe("mdy");
    expect(detectDateOrder(["15.09.2026", "01.10.2026"])).toBe("dmy");
    expect(detectDateOrder(["01.02.2026", "03.04.2026"])).toBe("dmy");
  });

  it("время «8:05» и «08:05:30» — «08:05»; 25:00 — нет", () => {
    expect(parseTime("8:05")).toBe("08:05");
    expect(parseTime("08:05:30")).toBe("08:05");
    expect(parseTime("25:00")).toBeUndefined();
  });
});
