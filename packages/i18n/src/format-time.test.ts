// DES-17: формат времени суток.
import { describe, expect, it } from "vitest";
import { formatTime } from "./format-time.ts";

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
