// Период — включительные границы LocalDate: «октябрь» — с 2026-10-01 по 2026-10-31 включительно.
import { describe, expect, it } from "vitest";
import { LocalDate } from "./local-date.ts";
import { Period } from "./period.ts";

const day = (text: string) => LocalDate.parse(text);

describe("Period", () => {
  it("обе границы входят в период", () => {
    const october = Period.of(day("2026-10-01"), day("2026-10-31"));
    expect([
      Period.contains(october, day("2026-10-01")),
      Period.contains(october, day("2026-10-31")),
    ]).toEqual([true, true]);
  });

  it("день до начала и день после конца в период не входят", () => {
    const october = Period.of(day("2026-10-01"), day("2026-10-31"));
    expect([
      Period.contains(october, day("2026-09-30")),
      Period.contains(october, day("2026-11-01")),
    ]).toEqual([false, false]);
  });

  it("период из одного дня допустим", () => {
    expect(Period.of(day("2026-10-21"), day("2026-10-21"))).toEqual({
      from: "2026-10-21",
      to: "2026-10-21",
    });
  });

  it("начало позже конца — ошибка", () => {
    expect(() => Period.of(day("2026-10-31"), day("2026-10-01"))).toThrow(RangeError);
  });

  it("схема разбирает период «с провода» и отвергает перевёрнутый", () => {
    expect(Period.schema.parse({ from: "2026-10-01", to: "2026-10-31" })).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(Period.schema.safeParse({ from: "2026-10-31", to: "2026-10-01" }).success).toBe(false);
  });
});
