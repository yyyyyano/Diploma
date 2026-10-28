// DES-17: ввод суммы человеком → целые копейки без float.
import { describe, expect, it } from "vitest";
import { parseMoney } from "./parse-money.ts";

describe("DES-17: разбор введённой суммы", () => {
  it.each([
    ["2 400,50", 240_050],
    ["2400.5", 240_050],
    ["0,10", 10],
    ["15", 1_500],
    ["1 234,56", 123_456],
    ["−12", -1_200],
    ["-0", 0],
  ])("«%s» → %i копеек", (text, minor) => {
    expect(parseMoney(text, "BYN")).toEqual({ minor, currency: "BYN" });
  });

  it.each(["", "abc", "1,234", "12,5,0", "9999999999999999"])("«%s» — не сумма", (text) => {
    expect(parseMoney(text, "BYN")).toBeUndefined();
  });
});
