// BUD-01: календарный месяц лимитов и дни до его конца.
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { daysLeft, monthBounds, monthOf } from "./month.ts";

const day = (text: string) => LocalDate.parse(text);

describe("BUD-01: месяц лимита", () => {
  it("месяц дня — «ГГГГ-ММ»", () => {
    expect(monthOf(day("2026-10-28"))).toBe("2026-10");
  });

  it("границы: октябрь — 31 день, февраль 2028 — 29, декабрь заканчивается 31-го", () => {
    expect(monthBounds("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthBounds("2028-02").to).toBe("2028-02-29");
    expect(monthBounds("2026-12").to).toBe("2026-12-31");
  });

  it("не месяц — ошибка программы", () => {
    expect(() => monthBounds("2026-13")).toThrow(RangeError);
    expect(() => monthBounds("2026-1")).toThrow(RangeError);
  });
});

describe("BUD-01: дней до конца месяца", () => {
  it("21 октября — 11 дней (21-е входит), 31 октября — 1, 1 ноября для октября — 0", () => {
    expect(daysLeft(day("2026-10-21"), "2026-10")).toBe(11);
    expect(daysLeft(day("2026-10-31"), "2026-10")).toBe(1);
    expect(daysLeft(day("2026-11-01"), "2026-10")).toBe(0);
  });

  it("будущий месяц — все его дни", () => {
    expect(daysLeft(day("2026-10-21"), "2026-11")).toBe(30);
  });
});
