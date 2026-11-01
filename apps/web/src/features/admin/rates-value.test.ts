// CAL-02, CAL-04, ADM-11: значение параметра таблицы ставок читается и показывается по единице.
import { describe, expect, it } from "vitest";
import { parseRateValue, rateValueInput } from "./rates-value.ts";

describe("ADM-11: ввод значения по единице", () => {
  it("деньги и проценты — как раньше: «216,50» → 21650, «13,5» → 1350", () => {
    expect(parseRateValue("byn-minor", "216,50")).toBe(21_650);
    expect(parseRateValue("percent-bp", "13,5")).toBe(1350);
    expect(parseRateValue("byn-minor", "abc")).toBeUndefined();
  });

  it("месяцы — целое: «24» → 24; «0», «2,5» и текст не принимаются", () => {
    expect(parseRateValue("months", "24")).toBe(24);
    for (const bad of ["0", "2,5", "два", "", "601"]) {
      expect(parseRateValue("months", bad)).toBeUndefined();
    }
  });

  it("день года — «15.11» → 1115, «31.03» → 331; 31.02 по числу дней не проверяется, 15.13 и 32.01 — нет", () => {
    expect(parseRateValue("month-day", "15.11")).toBe(1115);
    expect(parseRateValue("month-day", "31.03")).toBe(331);
    expect(parseRateValue("month-day", "15.13")).toBeUndefined();
    expect(parseRateValue("month-day", "32.01")).toBeUndefined();
    expect(parseRateValue("month-day", "15")).toBeUndefined();
  });

  it("число месяца — от 1 до 31", () => {
    expect(parseRateValue("day-of-month", "22")).toBe(22);
    expect(parseRateValue("day-of-month", "32")).toBeUndefined();
  });

  it("обратно: значение в поле — то же, что вводит человек", () => {
    expect(rateValueInput("months", 24)).toBe("24");
    expect(rateValueInput("month-day", 1115)).toBe("15.11");
    expect(rateValueInput("month-day", 331)).toBe("31.03");
    expect(rateValueInput("day-of-month", 22)).toBe("22");
    expect(rateValueInput("percent-bp", 1300)).toBe("13");
    expect(rateValueInput("byn-minor", 21_600)).toBe("216");
  });
});
