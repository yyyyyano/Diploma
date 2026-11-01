// WEEK-01, WEEK-03, NFR-22: какую неделю охватывает сводка и когда она «пора». 2026-11-02 — понедельник.
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { mondayOf, weekdayOf, weekToSummarize } from "./schedule.ts";

const day = (text: string) => LocalDate.parse(text);

describe("weekdayOf, mondayOf", () => {
  it.each([
    ["2026-11-02", 1, "2026-11-02"],
    ["2026-11-04", 3, "2026-11-02"],
    ["2026-11-08", 7, "2026-11-02"],
    ["2026-11-09", 1, "2026-11-09"],
    ["2027-01-01", 5, "2026-12-28"],
  ])("%s — день %d, понедельник %s", (date, weekday, monday) => {
    expect(weekdayOf(day(date))).toBe(weekday);
    expect(mondayOf(day(date))).toBe(monday);
  });
});

describe("weekToSummarize: понедельник, 09:00 (по умолчанию)", () => {
  const at = (today: string, now: string) =>
    weekToSummarize({ today: day(today), now, weekday: 1, time: "09:00" });

  it("в понедельник в 09:00 — сводка за прошлую неделю: 26.10–01.11", () => {
    expect(at("2026-11-02", "09:00")).toEqual({
      scheduledOn: "2026-11-02",
      weekStart: "2026-10-26",
      weekEnd: "2026-11-01",
    });
  });

  it("в понедельник в 08:59 момент ещё не наступил: берётся прошлый понедельник — неделя 19.10–25.10", () => {
    expect(at("2026-11-02", "08:59")).toMatchObject({
      scheduledOn: "2026-10-26",
      weekStart: "2026-10-19",
      weekEnd: "2026-10-25",
    });
  });

  it("компьютер был выключен в понедельник, включили в четверг — один итог за ту же неделю 26.10–01.11", () => {
    expect(at("2026-11-05", "12:00")).toMatchObject({
      weekStart: "2026-10-26",
      weekEnd: "2026-11-01",
    });
  });

  it("не включали три недели — один итог за последнюю неделю, а не три", () => {
    expect(at("2026-11-23", "10:00")).toMatchObject({
      weekStart: "2026-11-16",
      weekEnd: "2026-11-22",
    });
  });

  it("воскресенье накануне понедельника — всё ещё прошлый момент", () => {
    expect(at("2026-11-08", "23:59")).toMatchObject({ weekStart: "2026-10-26" });
  });
});

describe("weekToSummarize: другой день и время", () => {
  it("пятница 18:30: в четверг ещё прошлая пятница, в пятницу после 18:30 — новая; неделя — всё равно полная прошлая", () => {
    const at = (today: string, now: string) =>
      weekToSummarize({ today: day(today), now, weekday: 5, time: "18:30" });
    expect(at("2026-11-05", "20:00")).toMatchObject({
      scheduledOn: "2026-10-30",
      weekStart: "2026-10-19",
    });
    expect(at("2026-11-06", "18:29")).toMatchObject({ scheduledOn: "2026-10-30" });
    expect(at("2026-11-06", "18:30")).toMatchObject({
      scheduledOn: "2026-11-06",
      weekStart: "2026-10-26",
      weekEnd: "2026-11-01",
    });
  });

  it("воскресенье: сводка в воскресенье за неделю, которая ещё идёт, не делается — берётся предыдущая полная", () => {
    expect(
      weekToSummarize({ today: day("2026-11-08"), now: "10:00", weekday: 7, time: "09:00" }),
    ).toMatchObject({ scheduledOn: "2026-11-08", weekStart: "2026-10-26" });
  });

  it("плохое время или день недели — RangeError", () => {
    const base = { today: day("2026-11-02"), now: "09:00", weekday: 1, time: "09:00" };
    expect(() => weekToSummarize({ ...base, time: "9:00" })).toThrow(RangeError);
    expect(() => weekToSummarize({ ...base, now: "25:00" })).toThrow(RangeError);
    expect(() => weekToSummarize({ ...base, weekday: 0 })).toThrow(RangeError);
    expect(() => weekToSummarize({ ...base, weekday: 8 })).toThrow(RangeError);
  });
});
