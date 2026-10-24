// Тесты офлайн и детерминированно (.claude/rules/testing.md): время — FakeClock; «сегодня» — по часовому поясу
// системы, как у настоящих часов (NFR-23).
import type { Clock } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { FakeClock } from "./fake-clock.ts";

describe("FakeClock", () => {
  it("now — заданный момент", () => {
    const clock: Clock = new FakeClock("2026-10-21T09:00:00Z");
    expect(clock.now().toISOString()).toBe("2026-10-21T09:00:00.000Z");
  });

  it("today — день по Минску: 21:30 UTC 21 октября — уже 22 октября", () => {
    expect(new FakeClock("2026-10-21T21:30:00Z").today()).toBe("2026-10-22");
  });

  it("часовой пояс — настройка: в UTC тот же момент ещё 21 октября", () => {
    expect(new FakeClock("2026-10-21T21:30:00Z", "UTC").today()).toBe("2026-10-21");
  });

  it("advance переводит часы вперёд: через 3 часа после 20:00 UTC в Минске следующий день", () => {
    const clock = new FakeClock("2026-10-21T20:00:00Z");
    clock.advance(3 * 60 * 60 * 1000);
    expect([clock.now().toISOString(), clock.today()]).toEqual([
      "2026-10-21T23:00:00.000Z",
      "2026-10-22",
    ]);
  });

  it("set ставит часы на другой момент", () => {
    const clock = new FakeClock("2026-10-21T09:00:00Z");
    clock.set("2027-01-01T00:00:00Z");
    expect(clock.today()).toBe("2027-01-01");
  });

  it("изменение возвращённой даты не двигает часы", () => {
    const clock = new FakeClock("2026-10-21T09:00:00Z");
    clock.now().setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe("2026-10-21T09:00:00.000Z");
  });

  it("недействительный момент — ошибка сразу, а не странный «сегодня» потом", () => {
    expect(() => new FakeClock("не дата")).toThrow(RangeError);
  });
});
