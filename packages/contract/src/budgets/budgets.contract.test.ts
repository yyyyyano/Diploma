// BUD-01…07: форма входов лимитов и целей — владельца во входе нет, суммы только в Money, категория — ключ агрегата.
import { describe, expect, it } from "vitest";
import {
  BudgetMonth,
  CategoryKey,
  ContributeInput,
  CreateGoalInput,
  SetLimitInput,
} from "./budgets.contract.ts";

const ID = "0197f2c0-0000-7000-8000-000000000001";
const byn = (minor: number) => ({ minor, currency: "BYN" });

describe("BUD-01: вход лимита", () => {
  it("категория — «system:код» или «custom:id», как ключ группы агрегата и параметр «Операций»", () => {
    expect(CategoryKey.safeParse("system:cafe").success).toBe(true);
    expect(CategoryKey.safeParse(`custom:${ID}`).success).toBe(true);
    expect(CategoryKey.safeParse("cafe").success).toBe(false);
    expect(CategoryKey.safeParse("system:").success).toBe(false);
  });

  it("лимит принимает сумму и флаги порогов; лишнее поле (владелец) отвергается", () => {
    const ok = { categoryKey: "system:taxi", limit: byn(10_000), notify80: false };
    expect(SetLimitInput.safeParse(ok).success).toBe(true);
    expect(SetLimitInput.safeParse({ ...ok, userId: ID }).success).toBe(false);
    expect(SetLimitInput.safeParse({ ...ok, limit: 100 }).success).toBe(false);
  });

  it("месяц — «ГГГГ-ММ», тринадцатого месяца нет", () => {
    expect(BudgetMonth.safeParse("2026-10").success).toBe(true);
    expect(BudgetMonth.safeParse("2026-13").success).toBe(false);
  });
});

describe("BUD-04: вход цели и взноса", () => {
  it("цель: название, вид, сумма и срок; название из пробелов не годится", () => {
    const ok = { name: "Отпуск", kind: "piggy", target: byn(300_000), deadline: "2027-06-01" };
    expect(CreateGoalInput.safeParse(ok).success).toBe(true);
    expect(CreateGoalInput.safeParse({ ...ok, name: "  " }).success).toBe(false);
    expect(CreateGoalInput.safeParse({ ...ok, kind: "jar" }).success).toBe(false);
    expect(CreateGoalInput.safeParse({ ...ok, householdId: ID }).success).toBe(false);
  });

  it("взнос: id цели и сумма", () => {
    expect(ContributeInput.safeParse({ goalId: ID, amount: byn(20_000) }).success).toBe(true);
    expect(ContributeInput.safeParse({ amount: byn(20_000) }).success).toBe(false);
  });
});
