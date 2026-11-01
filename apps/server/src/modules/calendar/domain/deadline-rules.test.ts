// CAL-02: дни событий по правилам сроков — по значениям из таблицы ставок (15 ноября = 1115, 31 марта = 331, 22-е число = 22).
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import {
  DEADLINE_RULES,
  eventKey,
  MONTHLY_HORIZON,
  ruleDays,
  ruleOfKey,
  type RuleFacts,
} from "./deadline-rules.ts";

const day = (iso: string) => LocalDate.parse(iso);
const rule = (key: string) => {
  const found = DEADLINE_RULES.find((r) => r.key === key);
  if (found === undefined) throw new Error(`нет правила ${key}`);
  return found;
};
const none: RuleFacts = {
  apartment: false,
  land: false,
  car: false,
  npd: false,
  ip: false,
  deductionYears: [],
};

describe("CAL-02: годовые сроки", () => {
  it("15 ноября ещё впереди — срок этого года", () => {
    expect(ruleDays(rule("property-tax"), "month-day", 1115, none, day("2026-11-01"))).toEqual([
      "2026-11-15",
    ]);
  });
  it("в сам день срока событие ещё создаётся, на следующий день — срок следующего года", () => {
    expect(ruleDays(rule("land-tax"), "month-day", 1115, none, day("2026-11-15"))).toEqual([
      "2026-11-15",
    ]);
    expect(ruleDays(rule("land-tax"), "month-day", 1115, none, day("2026-11-16"))).toEqual([
      "2027-11-15",
    ]);
  });
  it("31 марта: после срока — март следующего года", () => {
    expect(ruleDays(rule("declaration"), "month-day", 331, none, day("2026-04-01"))).toEqual([
      "2027-03-31",
    ]);
  });
  it("29 февраля в невисокосный год — 28 февраля, значение вне календаря — нет события", () => {
    expect(ruleDays(rule("declaration"), "month-day", 229, none, day("2027-01-10"))).toEqual([
      "2027-02-28",
    ]);
    expect(ruleDays(rule("declaration"), "month-day", 1332, none, day("2027-01-10"))).toEqual([]);
  });
  it("единица не та (число месяца вместо дня года) — события нет: чужое значение не читается как дата", () => {
    expect(ruleDays(rule("property-tax"), "day-of-month", 22, none, day("2026-11-01"))).toEqual([]);
  });
});

describe("CAL-02: ежемесячный срок НПД", () => {
  it("22-е число: ближайшие шесть сроков, через границу года", () => {
    const days = ruleDays(rule("npd-payment"), "day-of-month", 22, none, day("2026-11-23"));
    expect(days).toEqual([
      "2026-12-22",
      "2027-01-22",
      "2027-02-22",
      "2027-03-22",
      "2027-04-22",
      "2027-05-22",
    ]);
    expect(days).toHaveLength(MONTHLY_HORIZON);
  });
  it("22-е ещё не прошло — текущий месяц первым; 31-е в коротком месяце — последний день месяца", () => {
    expect(ruleDays(rule("npd-payment"), "day-of-month", 22, none, day("2026-11-01"))[0]).toBe(
      "2026-11-22",
    );
    expect(ruleDays(rule("npd-payment"), "day-of-month", 31, none, day("2027-02-01"))[0]).toBe(
      "2027-02-28",
    );
  });
});

describe("CAL-02, TAX: декларация по найденному вычету", () => {
  it("вычет за 2026 год → декларация до 31.03.2027; прошедший срок не создаётся", () => {
    const facts = { ...none, deductionYears: [2026, 2024] };
    expect(
      ruleDays(rule("declaration-deduction"), "month-day", 331, facts, day("2026-11-01")),
    ).toEqual(["2027-03-31"]);
  });
});

describe("CAL-02: правило без даты и ключи", () => {
  it("правило без параметра — дней нет, ключ без года", () => {
    expect(rule("inspection").param).toBeNull();
    expect(ruleDays(rule("inspection"), "month-day", 0, none, day("2026-11-01"))).toEqual([]);
    expect(eventKey(rule("inspection"), null)).toBe("rule:inspection");
  });
  it("ключи: год для годовых, месяц для НПД; правило находится по ключу", () => {
    expect(eventKey(rule("transport-tax"), day("2026-11-15"))).toBe("rule:transport-tax:2026");
    expect(eventKey(rule("npd-payment"), day("2026-12-22"))).toBe("rule:npd-payment:2026-12");
    expect(ruleOfKey("rule:npd-payment:2026-12")?.key).toBe("npd-payment");
    expect(ruleOfKey("warranty:abc")).toBeUndefined();
    expect(ruleOfKey(null)).toBeUndefined();
  });
  it("правило включают только свои факты", () => {
    const enabledBy = (facts: RuleFacts) =>
      DEADLINE_RULES.filter((r) => r.enabled(facts)).map((r) => r.key);
    expect(enabledBy(none)).toEqual([]);
    expect(enabledBy({ ...none, car: true })).toEqual(["transport-tax", "inspection"]);
    expect(enabledBy({ ...none, apartment: true, npd: true })).toEqual([
      "property-tax",
      "npd-payment",
    ]);
    expect(enabledBy({ ...none, ip: true, deductionYears: [2026] })).toEqual([
      "declaration",
      "declaration-deduction",
    ]);
  });
});
