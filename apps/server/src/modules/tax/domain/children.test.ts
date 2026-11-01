// TAX-01, PROF-06: дети для стандартного вычета — только до 18 лет на сегодня; повышенный вычет (120 вместо 63) — двое и более детей,
// ребёнок-инвалид, одинокий родитель, вдова (вдовец), опекун, приёмный родитель (ст. 209 п. 1.2 НК).
import type { FactEvaluation, FamilyStatus } from "@kosht/contract";
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { standardChildren } from "./children.ts";

const evaluation = (ages: (number | null)[]): FactEvaluation => ({
  onDate: LocalDate.parse("2026-11-01"),
  childAges: ages,
  childrenUnder18: ages.filter((age) => age !== null && age < 18).length,
});
const kid = (disability = false) => ({ disability });

describe("TAX-01: дети до 18 лет на сегодня", () => {
  it("детей в профиле нет — ноль", () => {
    expect(standardChildren(undefined, undefined, [])).toEqual({ count: 0, increased: false });
  });

  it("ребёнок 9 лет — один, обычный вычет", () => {
    expect(standardChildren([kid()], evaluation([9]), [])).toEqual({ count: 1, increased: false });
  });

  it("ребёнку исполнилось 18 — больше не считается (PROF-06)", () => {
    expect(standardChildren([kid(), kid()], evaluation([18, 9]), [])).toEqual({
      count: 1,
      increased: false,
    });
  });

  it("возраст ребёнка не известен — не считается: вычет не придумываем", () => {
    expect(standardChildren([kid()], evaluation([null]), [])).toEqual({
      count: 0,
      increased: false,
    });
  });
});

describe("TAX-07, пример 3: повышенный вычет", () => {
  it("двое детей до 18 — повышенный на каждого", () => {
    expect(standardChildren([kid(), kid()], evaluation([17, 9]), [])).toEqual({
      count: 2,
      increased: true,
    });
  });

  it("один ребёнок-инвалид — повышенный", () => {
    expect(standardChildren([kid(true)], evaluation([7]), [])).toEqual({
      count: 1,
      increased: true,
    });
  });

  it("ребёнок-инвалид старше 18 лет повышения не даёт", () => {
    expect(standardChildren([kid(true), kid()], evaluation([19, 5]), [])).toEqual({
      count: 1,
      increased: false,
    });
  });

  it.each<FamilyStatus>(["singleParent", "widowed", "guardian", "fosterParent"])(
    "один ребёнок и статус %s — повышенный",
    (status) => {
      expect(standardChildren([kid()], evaluation([5]), [status])).toEqual({
        count: 1,
        increased: true,
      });
    },
  );
});
