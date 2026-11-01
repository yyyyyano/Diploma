// WEEK-02: числа итогов недели — среднее по прошлым неделям и отклонение этой недели от обычного в процентах. Траты недели,
// категории и лимиты считают `transactions` и `budgets` (их числа берутся как есть); здесь — только то, чего у них нет.
// Округление явное, правило и шаг — в трассе.
import { Money } from "@kosht/kernel";
import { node, trace, type Calc } from "../calc.ts";
import { divideRounded, roundingNote } from "../rounding.ts";

const HALF_UP = "half-up-kopeck" as const;

/**
 * Средние траты за неделю = траты за `weeks` прошлых недель ÷ `weeks`, до копейки (половина от нуля). Недель меньше одной —
 * `RangeError`: среднего нет, вызывающий не сравнивает.
 */
export function weeklyAverage(total: Calc<Money>, weeks: Calc<number>): Calc<Money> {
  if (!Number.isInteger(weeks.value) || weeks.value < 1) {
    throw new RangeError(
      `weekly.average: недель не меньше одной, получено ${String(weeks.value)}.`,
    );
  }
  const minor = divideRounded(BigInt(total.value.minor), BigInt(weeks.value), HALF_UP);
  const value = Money.of(Number(minor), total.value.currency);
  return {
    value,
    trace: trace(
      "weekly.average",
      "avg",
      value,
      [total.trace, weeks.trace],
      [],
      `траты за прошлые недели ÷ число недель; ${roundingNote(HALF_UP)}`,
    ),
  };
}

/**
 * Насколько траты недели больше (+) или меньше (−) обычных, в процентах: (неделя − среднее) × 100 ÷ среднее, до целого процента
 * (половина от нуля). Среднее не больше нуля — сравнивать не с чем, `null` (а не «+∞ %» и не ноль).
 */
export function deviationPercent(week: Calc<Money>, average: Calc<Money>): Calc<number> | null {
  Money.sameCurrency([week.value, average.value]);
  if (average.value.minor <= 0) return null;
  const exact = (BigInt(week.value.minor) - BigInt(average.value.minor)) * 100n;
  const value = Number(divideRounded(exact, BigInt(average.value.minor), HALF_UP));
  return {
    value,
    trace: trace(
      "weekly.deviation",
      "round",
      value,
      [week.trace, average.trace],
      [],
      `(неделя − среднее) × 100 ÷ среднее; ${roundingNote(HALF_UP)}`,
    ),
  };
}

/** Число недель в среднем — лист трассы (по умолчанию 8, WEEK-02). */
export function weeksNode(weeks: number): Calc<number> {
  return node("weekly.weeks", weeks);
}
