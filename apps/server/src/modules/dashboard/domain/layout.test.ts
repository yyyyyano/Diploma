// DASH-02: ряды диаграммы категорий (≤ 6 + «Остальное») и шесть месяцев динамики.
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { monthOfDay, monthsEndingAt, splitTop } from "./layout.ts";

const group = (key: string, minor: number) => ({ key, minor });

describe("DASH-02: траты по категориям — не больше шести рядов", () => {
  it("семь категорий: шесть крупнейших по убыванию и одна в «Остальном»", () => {
    const groups = [10, 70, 30, 60, 20, 50, 40].map((minor) =>
      group(`system:c${String(minor)}`, minor),
    );
    const { top, rest } = splitTop(groups, 6);
    expect(top.map((g) => g.minor)).toEqual([70, 60, 50, 40, 30, 20]);
    expect(rest.map((g) => g.minor)).toEqual([10]);
  });

  it("нулевые и отрицательные (возвратов больше покупок) на диаграмму не попадают", () => {
    const { top, rest } = splitTop([group("a", 0), group("b", -500), group("c", 100)], 6);
    expect(top.map((g) => g.key)).toEqual(["c"]);
    expect(rest).toEqual([]);
  });

  it("равные суммы — по ключу, порядок не плавает", () => {
    const { top } = splitTop([group("system:b", 5), group("system:a", 5)], 6);
    expect(top.map((g) => g.key)).toEqual(["system:a", "system:b"]);
  });
});

describe("DASH-02: динамика — шесть месяцев до месяца конца периода", () => {
  it("октябрь 2026 → май…октябрь; через границу года — июль…декабрь 2025 → февраль…январь", () => {
    expect(monthsEndingAt("2026-10", 6)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(monthsEndingAt("2026-02", 6)).toEqual([
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("месяц дня", () => {
    expect(monthOfDay(LocalDate.parse("2026-10-28"))).toBe("2026-10");
  });
});
