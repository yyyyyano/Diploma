// NFR-23: календарный день считается по часовому поясу системы (по умолчанию Минск, UTC+3); часовой пояс —
// настройка, поэтому он всегда приходит аргументом.
import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, LocalDate } from "./local-date.ts";

describe("NFR-23: LocalDate.fromInstant", () => {
  it("21:30 UTC 21 октября — в Минске уже 22 октября", () => {
    expect(LocalDate.fromInstant(new Date("2026-10-21T21:30:00Z"), "Europe/Minsk")).toBe(
      "2026-10-22",
    );
  });

  it("20:59 UTC 21 октября — в Минске ещё 21 октября", () => {
    expect(LocalDate.fromInstant(new Date("2026-10-21T20:59:59Z"), DEFAULT_TIME_ZONE)).toBe(
      "2026-10-21",
    );
  });

  it("тот же момент в другом часовом поясе — другой день: пояс берётся из настройки", () => {
    expect(LocalDate.fromInstant(new Date("2026-10-21T21:30:00Z"), "UTC")).toBe("2026-10-21");
  });

  it("часовой пояс по умолчанию — Минск", () => {
    expect(DEFAULT_TIME_ZONE).toBe("Europe/Minsk");
  });

  it("неизвестный часовой пояс — ошибка, а не молчаливый UTC", () => {
    expect(() =>
      LocalDate.fromInstant(new Date("2026-10-21T00:00:00Z"), "Europe/Atlantis"),
    ).toThrow(RangeError);
  });

  it("недействительная дата — ошибка", () => {
    expect(() => LocalDate.fromInstant(new Date("не дата"), DEFAULT_TIME_ZONE)).toThrow(RangeError);
  });
});

describe("LocalDate.parse", () => {
  it("день в формате ISO становится LocalDate", () => {
    expect(LocalDate.parse("2024-02-29")).toBe("2024-02-29");
  });

  it.each(["2026-02-29", "2026-13-01", "21.10.2026", "2026-10-21T00:00:00Z", ""])(
    "«%s» — не календарный день",
    (text) => {
      expect(() => LocalDate.parse(text)).toThrow(RangeError);
    },
  );
});

describe("LocalDate.compare", () => {
  it("раньше, позже, тот же день", () => {
    const a = LocalDate.parse("2026-09-30");
    const b = LocalDate.parse("2026-10-01");
    expect([LocalDate.compare(a, b), LocalDate.compare(b, a), LocalDate.compare(a, a)]).toEqual([
      -1, 1, 0,
    ]);
  });
});
