import { testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { jobKey } from "./job-key.ts";

describe("ADR-0008: jobKey — ключ схлопывания с домохозяйством", () => {
  it("одинаковые части у двух домохозяйств дают разные ключи — задачи друг друга не подавляют", () => {
    const a = jobKey(testScope({ user: 1, household: 1 }), "budgets.recheck");
    const b = jobKey(testScope({ user: 2, household: 2 }), "budgets.recheck");
    expect(a).not.toBe(b);
  });

  it("два пользователя одного домохозяйства делят ключ: пересчёт домохозяйства один", () => {
    const first = jobKey(testScope({ user: 1, household: 1 }), "budgets.recheck");
    const second = jobKey(testScope({ user: 2, household: 1 }), "budgets.recheck");
    expect(first).toBe(second);
  });

  it("ключ начинается с id домохозяйства и содержит части по порядку", () => {
    const scope = testScope({ user: 1, household: 1 });
    expect(jobKey(scope, "receipts.recognize", "r1")).toBe(
      `${scope.householdId}:receipts.recognize:r1`,
    );
  });

  it("без частей ключа — ошибка: ключ из одного домохозяйства схлопнул бы все его задачи", () => {
    expect(() => jobKey(testScope())).toThrow(RangeError);
    expect(() => jobKey(testScope(), "")).toThrow(RangeError);
  });
});
