// AFF-03: выбор цели, из накоплений которой закрывается нехватка.
import { Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { pickGoal } from "./goals.ts";

const byn = (minor: number): Money => Money.of(minor, "BYN");
const goal = (id: string, saved: number | null, contribution: number | null) => ({
  id,
  saved: saved === null ? null : byn(saved),
  contribution: contribution === null ? null : byn(contribution),
});

describe("pickGoal", () => {
  it("цель с накоплением не меньше нехватки и положительным взносом", () => {
    expect(pickGoal(73_944, [goal("a", 200_000, 10_500)])?.id).toBe("a");
  });

  it("накоплено ровно нехватка — подходит; на копейку меньше — нет", () => {
    expect(pickGoal(1000, [goal("a", 1000, 100)])?.id).toBe("a");
    expect(pickGoal(1000, [goal("a", 999, 100)])).toBeNull();
  });

  it("из нескольких — с наибольшим накоплением, при равенстве — меньший id", () => {
    expect(pickGoal(100, [goal("a", 500, 10), goal("b", 900, 10)])?.id).toBe("b");
    expect(pickGoal(100, [goal("z", 500, 10), goal("b", 500, 10)])?.id).toBe("b");
  });

  it("нет накопленного (нет курса счёта), нет или нулевой взнос (цель достигнута) — цель не подходит", () => {
    expect(pickGoal(100, [goal("a", null, 10)])).toBeNull();
    expect(pickGoal(100, [goal("a", 500, null)])).toBeNull();
    expect(pickGoal(100, [goal("a", 500, 0)])).toBeNull();
    expect(pickGoal(100, [])).toBeNull();
  });
});
