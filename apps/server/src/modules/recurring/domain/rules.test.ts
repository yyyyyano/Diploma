// REC-02, REC-04, REC-05: разделы, начальное состояние, учёт в свободном остатке и окно «возможно прекращён».
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { countsInFreeBalance, initialState, missedFrom, sectionOf } from "./rules.ts";

const window = { monthlyDays: 10, otherPercent: 10 };

describe("REC-02: разделы", () => {
  it.each([
    ["income", "salary", "income"],
    ["expense", "utilities", "mandatory"],
    ["expense", "rent", "mandatory"],
    ["expense", "telecom", "mandatory"],
    ["expense", "loans", "mandatory"],
    ["expense", "subscriptions", "subscriptions"],
    ["expense", "kids", "other"],
    ["expense", null, "other"],
  ] as const)("%s в категории %s попадает в раздел %s", (flow, category, section) => {
    expect(sectionOf(flow, category)).toBe(section);
  });

  it("найденное в доходах, обязательных и подписках сразу действует, в «Других» — предположение", () => {
    expect(initialState("income")).toBe("active");
    expect(initialState("mandatory")).toBe("active");
    expect(initialState("subscriptions")).toBe("active");
    expect(initialState("other")).toBe("suggested");
  });
});

describe("REC-04: что входит в свободный остаток", () => {
  it("действующие и «возможно прекращён» обязательных — входят; «Другие», прекращённые и исключённые — нет", () => {
    expect(countsInFreeBalance("mandatory", "active")).toBe(true);
    expect(countsInFreeBalance("mandatory", "maybe-ended")).toBe(true);
    expect(countsInFreeBalance("other", "active")).toBe(false);
    expect(countsInFreeBalance("mandatory", "ended")).toBe(false);
    expect(countsInFreeBalance("income", "excluded")).toBe(false);
    expect(countsInFreeBalance("subscriptions", "suggested")).toBe(false);
  });
});

describe("REC-05: окно «возможно прекращён»", () => {
  it("ежемесячный: 10 дней после ожидаемой даты", () => {
    expect(missedFrom(LocalDate.parse("2026-10-12"), "month", window)).toBe("2026-10-22");
  });
  it("остальные: 10 % периода, не меньше дня — неделя 1, квартал 10, год 37", () => {
    const on = LocalDate.parse("2026-10-01");
    expect(missedFrom(on, "week", window)).toBe("2026-10-02");
    expect(missedFrom(on, "quarter", window)).toBe("2026-10-11");
    expect(missedFrom(on, "year", window)).toBe("2026-11-07");
  });
});
