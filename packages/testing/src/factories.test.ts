// Фабрики примитивов для тестов: детерминированные id и деньги без ручного набора uuid и копеек.
import { HouseholdId, TraceId, UserId } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { byn, day, testHouseholdId, testScope, testTraceId, testUserId } from "./factories.ts";

describe("фабрики примитивов", () => {
  it("byn — деньги в копейках BYN", () => {
    expect(byn(84_000)).toEqual({ minor: 84_000, currency: "BYN" });
  });

  it("day — календарный день", () => {
    expect(day("2026-10-21")).toBe("2026-10-21");
  });

  it("id — настоящие uuid своего бренда и одинаковы при каждом запуске", () => {
    expect([
      UserId.parse(testUserId(1)),
      HouseholdId.parse(testHouseholdId(1)),
      TraceId.parse(testTraceId(255)),
    ]).toEqual([
      "00000000-0000-7000-8100-000000000001",
      "00000000-0000-7000-8200-000000000001",
      "00000000-0000-7000-8300-0000000000ff",
    ]);
  });

  it("id пользователя и домохозяйства с одним номером различаются", () => {
    expect(testUserId(1)).not.toBe(testHouseholdId(1));
  });

  it("номер id — целое от 1: иначе ошибка", () => {
    expect(() => testUserId(0)).toThrow(RangeError);
  });

  it("testScope — пользователь 1 в домохозяйстве 1 по умолчанию", () => {
    expect(testScope()).toEqual({ userId: testUserId(1), householdId: testHouseholdId(1) });
  });

  it("testScope — второй пользователь в своём домохозяйстве", () => {
    expect(testScope({ user: 2, household: 2 })).toEqual({
      userId: testUserId(2),
      householdId: testHouseholdId(2),
    });
  });
});
