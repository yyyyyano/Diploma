import { afterEach, describe, expect, it, vi } from "vitest";
import { createClock, isTimeZone, TimeZoneSchema } from "./clock.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("NFR-23: «сегодня» по часовому поясу системы", () => {
  it("2026-10-21T21:30Z по Минску (UTC+3) — уже 2026-10-22", () => {
    vi.useFakeTimers({ now: new Date("2026-10-21T21:30:00Z") });
    expect(createClock().today()).toBe("2026-10-22");
  });

  it("тот же момент по UTC — ещё 2026-10-21; пояс берётся при каждом вызове", () => {
    vi.useFakeTimers({ now: new Date("2026-10-21T21:30:00Z") });
    let zone = "UTC";
    const clock = createClock(() => zone);
    expect(clock.today()).toBe("2026-10-21");
    zone = "Europe/Minsk";
    expect(clock.today()).toBe("2026-10-22");
  });

  it("now() — текущий момент", () => {
    vi.useFakeTimers({ now: new Date("2026-10-21T09:00:00Z") });
    expect(createClock().now().toISOString()).toBe("2026-10-21T09:00:00.000Z");
  });
});

describe("ADM-60: неверный пояс отвергается", () => {
  it.each(["Europe/Minsk", "UTC", "Asia/Tokyo"])("«%s» — пояс", (zone) => {
    expect(isTimeZone(zone)).toBe(true);
    expect(TimeZoneSchema.safeParse(zone).success).toBe(true);
  });

  it.each(["Europe/Минск", "Mars/Olympus", "", " Europe/Minsk", "../etc/passwd"])(
    "«%s» — не пояс",
    (zone) => {
      expect(isTimeZone(zone)).toBe(false);
      expect(TimeZoneSchema.safeParse(zone).error?.issues[0]?.message).toBe(
        "ожидается часовой пояс IANA, например Europe/Minsk",
      );
    },
  );
});
