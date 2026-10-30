// REC-02, REC-04, FIN-20: числа регулярных платежей — средняя сумма по операциям-основаниям, сумма в месяц и итог
// раздела. Всё в одной валюте (BYN-эквивалент операций); каждое число несёт трассу для «Откуда эта цифра?».
import { Money } from "@kosht/kernel";
import { node, trace, type Calc } from "../calc.ts";
import { avg, sum, type NonEmpty } from "../money-ops.ts";
import { divideRounded, roundingNote } from "../rounding.ts";

/** Период регулярного платежа (REC-01). */
export type RecurringPeriod = "week" | "month" | "quarter" | "year";

/** Операция-основание: id операции и её сумма в BYN. */
export interface Occurrence {
  readonly id: string;
  readonly amount: Money;
}

/** REC-02: средняя сумма платежа — среднее по операциям-основаниям, округление половина вверх до копейки. */
export function recurringAverage(occurrences: NonEmpty<Occurrence>): Calc<Money> {
  const leaves = occurrences.map((occurrence) =>
    node("recurring.occurrence", occurrence.amount, {
      refs: [{ kind: "transaction", id: occurrence.id }],
    }),
  ) as unknown as NonEmpty<Calc<Money>>;
  return avg("recurring.averageAmount", leaves, { rounding: "half-up-kopeck" });
}

/** Пересчёт в месяц дробью «× times ÷ per» — без промежуточного округления: неделя — 52 в году на 12 месяцев. */
const TO_MONTH = {
  week: { times: 52n, per: 12n, label: "× 52 недели ÷ 12 месяцев" },
  month: { times: 1n, per: 1n, label: "" },
  quarter: { times: 1n, per: 3n, label: "÷ 3 месяца" },
  year: { times: 1n, per: 12n, label: "÷ 12 месяцев" },
} as const satisfies Record<RecurringPeriod, unknown>;

/** REC-04: сумма платежа в пересчёте на месяц (для свободного остатка); месячный — без изменений. */
export function monthlyAmount(average: Calc<Money>, period: RecurringPeriod): Calc<Money> {
  if (period === "month") return average;
  const { times, per, label } = TO_MONTH[period];
  const minor = divideRounded(BigInt(average.value.minor) * times, per, "half-up-kopeck");
  const value = Money.of(Number(minor), average.value.currency);
  return {
    value,
    trace: trace(
      "recurring.monthlyAmount",
      "mul",
      value,
      [average.trace],
      [],
      `${label}; ${roundingNote("half-up-kopeck")}`,
    ),
  };
}

/** FIN-20: итог раздела в месяц; пустой раздел — ноль BYN. */
export function monthlyTotal(key: string, parts: readonly Calc<Money>[]): Calc<Money> {
  const [first, ...rest] = parts;
  if (first === undefined) return node(key, Money.of(0, "BYN"));
  return sum(key, [first, ...rest]);
}
