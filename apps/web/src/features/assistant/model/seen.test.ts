// CHAT-08: «Вижу: Главная · Октябрь 2026» — период страницы из адреса, целый месяц словами.
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { navKeyOf, seenPeriod } from "./seen.ts";

describe("CHAT-08: период страницы для подписи", () => {
  it("целый календарный месяц из from/to — «месяц и год», в том числе февраль и декабрь", () => {
    expect(seenPeriod({ from: "2026-09-01", to: "2026-09-30" })).toEqual({
      kind: "month",
      month: "09",
      year: "2026",
    });
    expect(seenPeriod({ from: "2028-02-01", to: "2028-02-29" })).toMatchObject({ month: "02" });
    expect(seenPeriod({ from: "2026-12-01", to: "2026-12-31" })).toMatchObject({ month: "12" });
  });

  it("неполный месяц и несколько месяцев — диапазон", () => {
    expect(seenPeriod({ from: "2026-09-01", to: "2026-09-15" })).toEqual({
      kind: "range",
      from: "2026-09-01",
      to: "2026-09-15",
    });
    expect(seenPeriod({ from: "2026-07-01", to: "2026-09-30" })).toMatchObject({ kind: "range" });
  });

  it("period=2026-09 — месяц; мусор и пустые параметры — без периода", () => {
    expect(seenPeriod({ period: "2026-09" })).toEqual({ kind: "month", month: "09", year: "2026" });
    expect(seenPeriod({ period: "сентябрь", from: "вчера" })).toBeUndefined();
    expect(seenPeriod({})).toBeUndefined();
  });

  it("главная без периода в адресе — текущий месяц по сегодняшнему дню", () => {
    expect(seenPeriod({ period: "current-month" }, LocalDate.parse("2026-10-31"))).toEqual({
      kind: "month",
      month: "10",
      year: "2026",
    });
  });

  it("одна граница — день как диапазон из одной даты", () => {
    expect(seenPeriod({ from: "2026-09-05" })).toEqual({
      kind: "range",
      from: "2026-09-05",
      to: "2026-09-05",
    });
  });
});

describe("CHAT-08: имя страницы по id маршрута", () => {
  it("разделы меню — по имени, вкладки администрирования — «admin», неизвестная — undefined", () => {
    expect(navKeyOf("dashboard")).toBe("dashboard");
    expect(navKeyOf("admin-users")).toBe("admin");
    expect(navKeyOf("mailbox")).toBeUndefined();
    expect(navKeyOf(undefined)).toBeUndefined();
  });
});
