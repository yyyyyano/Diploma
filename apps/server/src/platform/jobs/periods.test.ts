import { LocalDate } from "@kosht/kernel";
import { FakeClock } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { pendingPeriods } from "./periods.ts";

const day = (text: string) => LocalDate.parse(text);

describe("NFR-22: pendingPeriods — что догнать после водяного знака", () => {
  it("ежедневное расписание без простоя — один период: вчера", () => {
    expect(pendingPeriods(day("2026-10-20"), day("2026-10-22"), 1)).toEqual([
      { from: "2026-10-21", to: "2026-10-21" },
    ]);
  });

  it("компьютер был выключен три дня — все три пропущенных дня по порядку", () => {
    const clock = new FakeClock("2026-10-25T00:30:00Z"); // 03:30 по Минску
    expect(pendingPeriods(day("2026-10-21"), clock.today(), 1)).toEqual([
      { from: "2026-10-22", to: "2026-10-22" },
      { from: "2026-10-23", to: "2026-10-23" },
      { from: "2026-10-24", to: "2026-10-24" },
    ]);
  });

  it("сегодняшний день ещё идёт — его нет; водяной знак на вчера — догонять нечего", () => {
    expect(pendingPeriods(day("2026-10-21"), day("2026-10-22"), 1)).toEqual([]);
  });

  it("недельный период: незаконченная неделя не входит", () => {
    expect(pendingPeriods(day("2026-10-04"), day("2026-10-20"), 7)).toEqual([
      { from: "2026-10-05", to: "2026-10-11" },
      { from: "2026-10-12", to: "2026-10-18" },
    ]);
  });

  it("первый запуск — только последний закончившийся период, история не догоняется", () => {
    expect(pendingPeriods(undefined, day("2026-10-22"), 7)).toEqual([
      { from: "2026-10-15", to: "2026-10-21" },
    ]);
  });

  it("через конец месяца и года", () => {
    expect(pendingPeriods(day("2026-12-30"), day("2027-01-02"), 1)).toEqual([
      { from: "2026-12-31", to: "2026-12-31" },
      { from: "2027-01-01", to: "2027-01-01" },
    ]);
  });

  it("шаг не целое число дней ≥ 1 — ошибка", () => {
    expect(() => pendingPeriods(undefined, day("2026-10-22"), 0)).toThrow(RangeError);
    expect(() => pendingPeriods(undefined, day("2026-10-22"), 1.5)).toThrow(RangeError);
  });
});
