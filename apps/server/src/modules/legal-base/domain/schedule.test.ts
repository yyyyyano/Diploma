import { describe, expect, it } from "vitest";
import { checkSchedule, ClockTime, dailyCron, inWindow, localTime } from "./schedule.ts";

describe("LAW-30: время проверки законов", () => {
  it("«04:00» превращается в cron «0 4», а проход пополнения через 30 минут — в «30 4»", () => {
    expect(dailyCron("04:00")).toBe("0 4 * * *");
    expect(dailyCron("04:00", 30)).toBe("30 4 * * *");
  });

  it("проход пополнения за полночь переходит на следующие сутки по кругу", () => {
    expect(dailyCron("23:45", 30)).toBe("15 0 * * *");
  });

  it("формат времени — только «ЧЧ:ММ» 24-часовой", () => {
    expect(ClockTime.safeParse("04:00").success).toBe(true);
    expect(ClockTime.safeParse("4:00").success).toBe(false);
    expect(ClockTime.safeParse("24:00").success).toBe(false);
    expect(ClockTime.safeParse("04:60").success).toBe(false);
  });
});

describe("LAW-35: ночное окно", () => {
  it("время в окне 02:00–06:00 принимается, вне окна — нет", () => {
    expect(inWindow("04:00", "02:00", "06:00")).toBe(true);
    expect(inWindow("06:00", "02:00", "06:00")).toBe(true);
    expect(inWindow("07:00", "02:00", "06:00")).toBe(false);
  });

  it("окно через полночь 22:00–03:00 содержит 23:30 и 01:00, но не 12:00", () => {
    expect(inWindow("23:30", "22:00", "03:00")).toBe(true);
    expect(inWindow("01:00", "22:00", "03:00")).toBe(true);
    expect(inWindow("12:00", "22:00", "03:00")).toBe(false);
  });

  it("умолчание (04:00 в 02:00–06:00) годится", () => {
    expect(
      checkSchedule({ checkTime: "04:00", windowFrom: "02:00", windowTo: "06:00" }),
    ).toBeNull();
  });

  it("проверка вне окна отклоняется", () => {
    expect(checkSchedule({ checkTime: "12:00", windowFrom: "02:00", windowTo: "06:00" })).toBe(
      "outside-window",
    );
  });

  it("проверка у самого конца окна отклоняется: проход пополнения на 30 минут позже вышел бы из окна", () => {
    expect(checkSchedule({ checkTime: "05:45", windowFrom: "02:00", windowTo: "06:00" })).toBe(
      "outside-window",
    );
  });

  it("пустое окно (начало равно концу) отклоняется", () => {
    expect(checkSchedule({ checkTime: "04:00", windowFrom: "04:00", windowTo: "04:00" })).toBe(
      "window-empty",
    );
  });
});

describe("DES-17: время суток по поясу системы", () => {
  it("21:00 UTC — полночь в Минске (UTC+3): «00:00», а не «24:00»", () => {
    expect(localTime(new Date("2026-10-30T21:00:00Z"), "Europe/Minsk")).toBe("00:00");
    expect(localTime(new Date("2026-10-30T01:05:00Z"), "Europe/Minsk")).toBe("04:05");
  });
});
