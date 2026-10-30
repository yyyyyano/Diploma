// BUD-04, BUD-05, BUD-07: прогресс цели, рекомендуемый взнос, плановое значение на сегодня и «отстаёт от графика».
import { LocalDate, Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { node } from "../calc.ts";
import {
  goalBehind,
  goalPercent,
  goalPlanned,
  monthsLeft,
  recommendedContribution,
} from "./goals.ts";

const byn = (minor: number) => Money.of(minor, "BYN");
const day = (text: string) => LocalDate.parse(text);
const saved = (minor: number) => node("budgets.goalSaved", byn(minor));

describe("BUD-05: сколько месяцев осталось", () => {
  it("с 28.10.2026 до 01.06.2027 — 7 месяцев, до 01.03.2027 — 4 (как в макете)", () => {
    expect(monthsLeft(day("2026-10-28"), day("2027-06-01"))).toBe(7);
    expect(monthsLeft(day("2026-10-28"), day("2027-03-01"))).toBe(4);
  });

  it("срок в том же дне месяца — полный месяц: 28.10 → 28.12 = 2", () => {
    expect(monthsLeft(day("2026-10-28"), day("2026-12-28"))).toBe(2);
  });

  it("срок меньше месяца и просроченный — не меньше одного: взнос делится на 1", () => {
    expect(monthsLeft(day("2026-10-28"), day("2026-11-10"))).toBe(1);
    expect(monthsLeft(day("2026-10-28"), day("2026-09-01"))).toBe(1);
  });
});

describe("BUD-05: рекомендуемый взнос", () => {
  it("накопить 3 000 к июлю: 2 040 осталось на 3 месяца → 680, округление вверх до рубля", () => {
    const result = recommendedContribution({
      target: byn(300_000),
      saved: saved(96_000),
      months: 3,
    });
    expect(result.value).toEqual(byn(68_000));
    expect(result.trace.key).toBe("budgets.goalContribution");
    expect(result.trace.note).toBe("÷ 3 мес.; rounding=ceil-ruble step=100");
    expect(result.trace.inputs.map((input) => input.key)).toEqual([
      "budgets.goalRemaining",
      "budgets.goalMonthsLeft",
    ]);
  });

  it("не делится нацело: 1 000 на 3 месяца = 333,33 → 334 (вверх, чтобы уложиться в срок)", () => {
    const result = recommendedContribution({ target: byn(100_000), saved: saved(0), months: 3 });
    expect(result.value).toEqual(byn(33_400));
  });

  it("цель достигнута или перевыполнена — взнос 0", () => {
    expect(
      recommendedContribution({ target: byn(100_000), saved: saved(100_000), months: 2 }).value,
    ).toEqual(byn(0));
    expect(
      recommendedContribution({ target: byn(100_000), saved: saved(120_000), months: 2 }).value,
    ).toEqual(byn(0));
  });

  it("месяцев меньше одного — ошибка программы", () => {
    expect(() => recommendedContribution({ target: byn(100), saved: saved(0), months: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("BUD-04: прогресс цели", () => {
  it("2 150 из 3 000 → 71 % (вниз); цель перевыполнена — больше 100", () => {
    expect(goalPercent(saved(215_000), byn(300_000)).value).toBe(71);
    expect(goalPercent(saved(310_000), byn(300_000)).value).toBe(103);
    expect(goalPercent(saved(215_000), byn(300_000)).trace.key).toBe("budgets.goalPercent");
  });
});

describe("BUD-07: плановое значение и «отстаёт»", () => {
  it("равномерно от создания до срока: половина срока → половина суммы", () => {
    const planned = goalPlanned({
      target: byn(300_000),
      createdOn: day("2026-01-01"),
      deadline: day("2026-01-11"),
      today: day("2026-01-06"),
    });
    expect(planned.value).toEqual(byn(150_000));
    expect(planned.trace.note).toBe("× прошло дней ÷ всего дней; rounding=floor-kopeck step=1");
  });

  it("до создания — 0, после срока — вся сумма", () => {
    const base = {
      target: byn(300_000),
      createdOn: day("2026-01-01"),
      deadline: day("2026-01-11"),
    };
    expect(goalPlanned({ ...base, today: day("2025-12-01") }).value).toEqual(byn(0));
    expect(goalPlanned({ ...base, today: day("2026-03-01") }).value).toEqual(byn(300_000));
  });

  it("срок в день создания — плановая сумма целиком, деления на ноль нет", () => {
    const planned = goalPlanned({
      target: byn(100_000),
      createdOn: day("2026-01-01"),
      deadline: day("2026-01-01"),
      today: day("2026-01-01"),
    });
    expect(planned.value).toEqual(byn(100_000));
  });

  it("накоплено 800 при плане 1 000 и допуске 10 % — отстаёт; 900 — ещё нет (граница не «отстаёт»)", () => {
    expect(goalBehind(byn(80_000), byn(100_000), 10)).toBe(true);
    expect(goalBehind(byn(89_999), byn(100_000), 10)).toBe(true);
    expect(goalBehind(byn(90_000), byn(100_000), 10)).toBe(false);
  });
});
