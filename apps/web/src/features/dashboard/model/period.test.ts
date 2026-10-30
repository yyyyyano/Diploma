// DASH-01: арифметика периода главной — месяцы, границы года, свой период.
import { describe, expect, it } from "vitest";
import { LocalDate } from "@kosht/contract";
import { monthRange, shiftMonth, wholeMonth } from "./period.ts";

describe("DASH-01: период главной", () => {
  it("границы месяца: октябрь — 31 день, февраль 2028 — 29", () => {
    expect(monthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange("2028-02").to).toBe("2028-02-29");
  });

  it("сдвиг месяца через границу года", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });

  it("период — ровно месяц или свой", () => {
    expect(wholeMonth(monthRange("2026-10"))).toBe("2026-10");
    expect(
      wholeMonth({ from: LocalDate.parse("2026-10-01"), to: LocalDate.parse("2026-10-15") }),
    ).toBeUndefined();
    expect(
      wholeMonth({ from: LocalDate.parse("2026-09-15"), to: LocalDate.parse("2026-10-14") }),
    ).toBeUndefined();
  });
});
