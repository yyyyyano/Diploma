// DES-17, NFR-23: дата — «21.10.2026»; относительный день — по календарю, без часов и без Intl. «Сегодня» приходит
// аргументом (Clock.today() по поясу системы): часовой пояс учитывается только в LocalDate.fromInstant.
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { formatDate, formatRelativeDay } from "./format-date.ts";

const day = (iso: string): LocalDate => LocalDate.parse(iso);

describe("DES-17: formatDate", () => {
  it.each([
    ["2026-10-21", "21.10.2026"],
    ["2026-01-05", "05.01.2026"],
    ["2024-02-29", "29.02.2024"],
  ])("%s → %s", (iso, text) => {
    expect(formatDate(day(iso))).toBe(text);
  });
});

describe("NFR-23: formatRelativeDay", () => {
  const today = day("2026-10-21");

  it.each([
    ["2026-10-21", "сегодня"],
    ["2026-10-20", "вчера"],
    ["2026-10-22", "завтра"],
    ["2026-10-23", "послезавтра"],
    ["2026-10-24", "через 3 дн."],
    ["2026-10-28", "через 7 дн."],
    ["2026-10-19", "2 дн. назад"],
    ["2026-10-14", "7 дн. назад"],
  ])("%s при сегодня 2026-10-21 — «%s»", (date, text) => {
    expect(formatRelativeDay(day(date), today)).toBe(text);
  });

  it("дальше недели вперёд — дата", () => {
    expect(formatRelativeDay(day("2026-10-29"), today)).toBe("29.10.2026");
  });

  it("дальше недели назад — дата", () => {
    expect(formatRelativeDay(day("2026-10-13"), today)).toBe("13.10.2026");
  });

  it("через границу месяца: 31 октября → 1 ноября — завтра", () => {
    expect(formatRelativeDay(day("2026-11-01"), day("2026-10-31"))).toBe("завтра");
  });

  it("через границу месяца назад: 2 ноября → 28 октября — 5 дн. назад", () => {
    expect(formatRelativeDay(day("2026-10-28"), day("2026-11-02"))).toBe("5 дн. назад");
  });

  it("через границу года: 31 декабря → 1 января — завтра", () => {
    expect(formatRelativeDay(day("2027-01-01"), day("2026-12-31"))).toBe("завтра");
  });

  it("через границу года назад: 3 января 2027 → 27 декабря 2026 — 7 дн. назад", () => {
    expect(formatRelativeDay(day("2026-12-27"), day("2027-01-03"))).toBe("7 дн. назад");
  });

  it("високосный февраль: 28 февраля 2028 → 1 марта — послезавтра", () => {
    expect(formatRelativeDay(day("2028-03-01"), day("2028-02-28"))).toBe("послезавтра");
  });

  it("невисокосный февраль: 28 февраля 2027 → 1 марта — завтра", () => {
    expect(formatRelativeDay(day("2027-03-01"), day("2027-02-28"))).toBe("завтра");
  });

  it("ровно через год — дата, а не «через 365 дн.»", () => {
    expect(formatRelativeDay(day("2027-10-21"), today)).toBe("21.10.2027");
  });

  it("каждый день 2024–2028 (два високосных года): следующий — «завтра», через неделю — «через 7 дн.»", () => {
    // Эталон дней — Date в UTC (только в тесте): годы ≥ 1970 он считает верно.
    const iso = (ms: number): LocalDate => day(new Date(ms).toISOString().slice(0, 10));
    const DAY_MS = 86_400_000;
    const wrong: string[] = [];
    for (let ms = Date.UTC(2024, 0, 1); ms < Date.UTC(2029, 0, 1); ms += DAY_MS) {
      if (formatRelativeDay(iso(ms + DAY_MS), iso(ms)) !== "завтра") wrong.push(iso(ms));
      if (formatRelativeDay(iso(ms + 7 * DAY_MS), iso(ms)) !== "через 7 дн.") wrong.push(iso(ms));
    }
    expect(wrong).toEqual([]);
  });

  it("год до 100-го считается как есть, а не как 19xx", () => {
    expect(formatRelativeDay(day("0050-03-01"), day("0050-02-28"))).toBe("завтра");
  });
});
