// DES-17: формат времени суток.
import { describe, expect, it } from "vitest";
import { LocalDate } from "@kosht/kernel";
import { formatDayTime, formatTime } from "./format-time.ts";

describe("DES-17: время суток", () => {
  it("«08:47» и «08:47:00» — «08:47»; полночь и последняя минута суток", () => {
    expect(formatTime("08:47")).toBe("08:47");
    expect(formatTime("08:47:00")).toBe("08:47");
    expect(formatTime("00:00")).toBe("00:00");
    expect(formatTime("23:59")).toBe("23:59");
  });

  it("«24:00», «8:47» и текст — не время суток", () => {
    for (const bad of ["24:00", "8:47", "08:60", "утро", ""]) {
      expect(() => formatTime(bad)).toThrow(RangeError);
    }
  });
});

describe("CAL-07: момент напоминания — день и время", () => {
  const today = LocalDate.parse("2026-10-21");

  it("сегодня и вчера — словами, время — «чч:мм»", () => {
    expect(formatDayTime(today, "09:00", today)).toBe("сегодня, 09:00");
    expect(formatDayTime(LocalDate.parse("2026-10-20"), "18:40:12", today)).toBe("вчера, 18:40");
  });

  it("дальше недели — дата и время", () => {
    expect(formatDayTime(LocalDate.parse("2026-10-13"), "09:00", today)).toBe("13.10.2026, 09:00");
  });

  it("не время суток — RangeError, а не «сегодня, 9:0»", () => {
    expect(() => formatDayTime(today, "9:0", today)).toThrow(RangeError);
  });
});
