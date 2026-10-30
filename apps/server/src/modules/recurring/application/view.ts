// Платёж для чтения (REC-02, REC-04): строка таблицы → запись с числами `Calc` (средняя сумма с основаниями в `refs`,
// сумма в месяц) и итоги разделов. Числа считает только @kosht/calc; DTO для сайта берёт из записи `value`.
import {
  monthlyAmount,
  monthlyTotal,
  node,
  recurringAverage,
  mul,
  type Calc,
  type NonEmpty,
  type RecurringPeriod,
} from "@kosht/calc";
import { LocalDate, Money } from "@kosht/kernel";
import { daysBetween } from "../domain/dates.ts";
import { countsInFreeBalance, type Section, type State } from "../domain/rules.ts";
import type { Flow } from "../domain/detect.ts";
import type { ItemRow, StoredOccurrence } from "../infrastructure/db/recurring.repo.ts";

/** Платёж с посчитанными суммами: то, что фасад отдаёт соседям (`fin`, `dashboard`, позже `calendar` и `afford`). */
export interface RecurringEntry {
  readonly id: string;
  readonly name: string;
  readonly flow: Flow;
  readonly section: Section;
  readonly period: RecurringPeriod;
  readonly state: State;
  readonly source: "detected" | "manual";
  readonly anchorDay: number | null;
  /** Средняя сумма в BYN: операции-основания — в `refs` трассы; названная человеком — один лист. */
  readonly average: Calc<Money>;
  readonly amountIsManual: boolean;
  readonly amountRange: { readonly min: Money; readonly max: Money } | null;
  /** Сумма в пересчёте на месяц (REC-04). */
  readonly monthly: Calc<Money>;
  readonly nextExpectedOn: LocalDate;
  readonly lastOccurredOn: LocalDate | null;
  readonly overdueDays: number | null;
  readonly repeats: number;
  /** Повторы-основания (последние): операция, день и сумма в BYN — `fin` берёт из них среднее за свои месяцы. */
  readonly occurrences: readonly {
    readonly id: string;
    readonly on: LocalDate;
    readonly amount: Money;
  }[];
  readonly categoryCode: string | null;
  readonly categoryId: string | null;
  /** Входит ли в свободный остаток (REC-04). */
  readonly counted: boolean;
}

const byn = (minor: number) => Money.of(minor, "BYN");

export function occurrencesOf(row: ItemRow): StoredOccurrence[] {
  return row.occurrences as StoredOccurrence[];
}

/** Средняя сумма платежа: названная человеком или среднее по операциям-основаниям. */
export function averageOf(row: ItemRow): { calc: Calc<Money>; manual: boolean } {
  if (row.manualAmountMinor !== null) {
    return {
      calc: node("recurring.manualAmount", byn(row.manualAmountMinor)),
      manual: true,
    };
  }
  const occurrences = occurrencesOf(row);
  const [first, ...rest] = occurrences;
  if (first === undefined) return { calc: node("recurring.manualAmount", byn(0)), manual: true };
  const list: NonEmpty<{ id: string; amount: Money }> = [
    { id: first.id, amount: byn(first.minor) },
    ...rest.map((o) => ({ id: o.id, amount: byn(o.minor) })),
  ];
  return { calc: recurringAverage(list), manual: false };
}

export function toEntry(row: ItemRow, onDate: LocalDate): RecurringEntry {
  const { calc: average, manual } = averageOf(row);
  const occurrences = occurrencesOf(row);
  const minors = occurrences.map((o) => o.minor);
  const min = Math.min(...minors);
  const max = Math.max(...minors);
  const section = row.section as Section;
  const state = row.state as State;
  const nextExpectedOn = LocalDate.parse(row.nextExpectedOn);
  const late = daysBetween(nextExpectedOn, onDate);
  return {
    id: row.id,
    name: row.name,
    flow: row.flow as Flow,
    section,
    period: row.period as RecurringPeriod,
    state,
    source: row.source as "detected" | "manual",
    anchorDay: row.anchorDay,
    average,
    amountIsManual: manual,
    amountRange:
      !manual && minors.length > 1 && min !== max ? { min: byn(min), max: byn(max) } : null,
    monthly: monthlyAmount(average, row.period as RecurringPeriod),
    nextExpectedOn,
    lastOccurredOn: row.lastOccurredOn === null ? null : LocalDate.parse(row.lastOccurredOn),
    overdueDays: late > 0 ? late : null,
    repeats: occurrences.length,
    occurrences: occurrences.map((o) => ({
      id: o.id,
      on: LocalDate.parse(o.on),
      amount: byn(o.minor),
    })),
    categoryCode: row.categoryCode,
    categoryId: row.categoryId,
    counted: countsInFreeBalance(section, state),
  };
}

/** Итог раздела в месяц и в год по учитываемым платежам; у «Других» итога нет — они в остаток не входят. */
export function totalsOf(entries: readonly RecurringEntry[], section: Section) {
  if (section === "other") return { monthly: null, yearly: null };
  const monthly = monthlyTotal(
    "recurring.monthlyTotal",
    entries.filter((e) => e.section === section && e.counted).map((e) => e.monthly),
  );
  const yearly = mul("recurring.yearlyTotal", monthly, node("recurring.monthsInYear", 12));
  return { monthly, yearly };
}
