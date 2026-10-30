// BUD-04, BUD-05, BUD-07: цели. Прогресс — доля накопленного, рекомендуемый взнос — остаток до цели ÷ оставшиеся
// месяцы с округлением вверх до рубля (чтобы уложиться в срок), «отстаёт от графика» — накоплено меньше планового на
// сегодня (равномерно от создания до срока) за вычетом допуска. «Сегодня» и допуск — во входе.
import { LocalDate, Money } from "@kosht/kernel";
import { node, trace, type Calc } from "../calc.ts";
import { percentOf } from "./limits.ts";
import { sub } from "../money-ops.ts";
import { divideRounded, roundingNote } from "../rounding.ts";

const MS_PER_DAY = 86_400_000;

function parts(day: string): [number, number, number] {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return [year, month, date];
}

function dayNumber(day: string): number {
  const [year, month, date] = parts(day);
  return Math.floor(Date.UTC(year, month - 1, date) / MS_PER_DAY);
}

/**
 * BUD-05: сколько месяцев осталось до срока — полные, как возраст: с 28.10 до 01.06 — 7 (ноябрь…май), не меньше
 * одного: срок ближе месяца и просроченный делят остаток на 1 — «отложите всё сейчас».
 */
export function monthsLeft(today: LocalDate, deadline: LocalDate): number {
  const [fromYear, fromMonth, fromDay] = parts(today);
  const [toYear, toMonth, toDay] = parts(deadline);
  const whole = (toYear - fromYear) * 12 + (toMonth - fromMonth) - (toDay < fromDay ? 1 : 0);
  return Math.max(1, whole);
}

/** BUD-04: прогресс цели = накоплено × 100 ÷ цель, вниз до целого; перевыполнение — больше 100. */
export function goalPercent(saved: Calc<Money>, target: Money): Calc<number> {
  return percentOf("budgets.goalPercent", saved, node("budgets.goalTarget", target));
}

/** BUD-05: «Откладывайте по X в месяц» = (цель − накоплено) ÷ месяцев, вверх до рубля; цель достигнута — 0. */
export function recommendedContribution(input: {
  readonly target: Money;
  /** Накоплено со своей трассой: сумма взносов или остаток счёта в BYN (со ссылкой на курс). */
  readonly saved: Calc<Money>;
  readonly months: number;
}): Calc<Money> {
  const { target, saved, months } = input;
  if (!Number.isSafeInteger(months) || months < 1) {
    throw new RangeError(
      `budgets.goalContribution: месяцев не меньше одного, получено ${String(months)}.`,
    );
  }
  const remaining = sub("budgets.goalRemaining", node("budgets.goalTarget", target), [saved]);
  if (remaining.value.minor <= 0) {
    return node("budgets.goalContribution", Money.of(0, target.currency), {
      note: "цель достигнута",
    });
  }
  const minor = divideRounded(BigInt(remaining.value.minor), BigInt(months), "ceil-ruble");
  const value = Money.of(Number(minor), target.currency);
  return {
    value,
    trace: trace(
      "budgets.goalContribution",
      "mul",
      value,
      [remaining.trace, node("budgets.goalMonthsLeft", months).trace],
      [],
      `÷ ${String(months)} мес.; ${roundingNote("ceil-ruble")}`,
    ),
  };
}

/** BUD-07: плановая сумма на сегодня — равномерно от дня создания до срока, вниз до копейки; до создания — 0. */
export function goalPlanned(input: {
  readonly target: Money;
  readonly createdOn: LocalDate;
  readonly deadline: LocalDate;
  readonly today: LocalDate;
}): Calc<Money> {
  const { target } = input;
  const total = Math.max(0, dayNumber(input.deadline) - dayNumber(input.createdOn));
  const elapsed = Math.min(total, Math.max(0, dayNumber(input.today) - dayNumber(input.createdOn)));
  const minor =
    total === 0
      ? BigInt(target.minor)
      : divideRounded(BigInt(target.minor) * BigInt(elapsed), BigInt(total), "floor-kopeck");
  const value = Money.of(Number(minor), target.currency);
  return {
    value,
    trace: trace(
      "budgets.goalPlanned",
      "mul",
      value,
      [
        node("budgets.goalTarget", target).trace,
        node("budgets.goalElapsedDays", elapsed).trace,
        node("budgets.goalTotalDays", total).trace,
      ],
      [],
      `× прошло дней ÷ всего дней; ${roundingNote("floor-kopeck")}`,
    ),
  };
}

/** BUD-07: отстаёт — накоплено меньше планового на сегодня минус допуск (процент планового, по умолчанию 10). */
export function goalBehind(saved: Money, planned: Money, tolerancePct: number): boolean {
  return BigInt(saved.minor) * 100n < BigInt(planned.minor) * BigInt(100 - tolerancePct);
}
