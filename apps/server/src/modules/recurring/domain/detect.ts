// REC-01: поиск регулярных операций по истории — чистая функция. Один контрагент и направление (доход / расход),
// похожая сумма (серии одного получателя с разной суммой — аванс и зарплата — разделяются по сумме), устойчивый период
// (неделя, месяц, квартал, год), не меньше N повторов подряд. Пороги приходят аргументом (настройки `recurring.*`).
// Суммы здесь только сравниваются; среднее и сумма в месяц — в `@kosht/calc`.
import type { RecurringPeriod } from "@kosht/calc";
import type { LocalDate } from "@kosht/kernel";
import { addDays, dayInMonth, dayOfMonth, daysBetween, daysInMonth, monthIndex } from "./dates.ts";

export type Flow = "income" | "expense";

/** Операция истории: только то, что нужно поиску (без текстов описания). Сумма — эквивалент в BYN, копейки. */
export interface HistoryOp {
  readonly id: string;
  readonly merchantKey: string;
  readonly merchantName: string;
  readonly flow: Flow;
  readonly on: LocalDate;
  readonly amountMinor: number;
  readonly categoryCode: string | null;
  readonly categoryId: string | null;
}

export interface DetectSettings {
  /** Не меньше стольких повторов подряд (REC-01: 3). */
  readonly minRepeats: number;
  /** Для ежегодных (REC-01: 2). */
  readonly minRepeatsYear: number;
  /** Отклонение суммы от среднего серии, % (REC-01: 15). */
  readonly amountTolerancePct: number;
  /** Отклонение даты для месячных, квартальных и годовых, дней (REC-01: ±5). */
  readonly dayTolerance: number;
  /** Отклонение интервала для еженедельных, дней. */
  readonly weekTolerance: number;
  /** Сколько последних повторов серии идёт в основание средней суммы. */
  readonly window: number;
  /** Серия, у которой последний платёж старше стольких периодов, давно прекратилась и не предлагается. */
  readonly deadAfterPeriods: number;
}

export const DEFAULT_DETECT: DetectSettings = {
  minRepeats: 3,
  minRepeatsYear: 2,
  amountTolerancePct: 15,
  dayTolerance: 5,
  weekTolerance: 1,
  window: 6,
  deadAfterPeriods: 2,
};

export interface Candidate {
  readonly merchantKey: string;
  readonly merchantName: string;
  readonly flow: Flow;
  readonly period: RecurringPeriod;
  /** Последние повторы серии (≤ window), по возрастанию даты: основание средней суммы. */
  readonly occurrences: readonly HistoryOp[];
  /** Все операции серии: по ним «Операции» помечают регулярные строки. */
  readonly memberIds: readonly string[];
  /** День месяца серии (медиана); у еженедельных — null. */
  readonly anchorDay: number | null;
  readonly lastOccurredOn: LocalDate;
  readonly nextExpectedOn: LocalDate;
  readonly categoryCode: string | null;
  readonly categoryId: string | null;
}

/** Длина периода в днях: для «мертва ли серия» и окна «возможно прекращён». */
export const PERIOD_DAYS: Readonly<Record<RecurringPeriod, number>> = {
  week: 7,
  month: 30,
  quarter: 91,
  year: 365,
};

const STEP_MONTHS = { month: 1, quarter: 3, year: 12 } as const;

/** Серии одного получателя и направления по сумме: сумма в пределах допуска от среднего кластера — одна серия. */
function clusterByAmount(ops: readonly HistoryOp[], pct: number): HistoryOp[][] {
  const sorted = ops.toSorted((a, b) => a.amountMinor - b.amountMinor);
  const clusters: { items: HistoryOp[]; total: number }[] = [];
  for (const op of sorted) {
    const last = clusters.at(-1);
    const mean = last === undefined ? 0 : last.total / last.items.length;
    if (last !== undefined && Math.abs(op.amountMinor - mean) * 100 <= pct * mean) {
      last.items.push(op);
      last.total += op.amountMinor;
    } else {
      clusters.push({ items: [op], total: op.amountMinor });
    }
  }
  return clusters.map((cluster) => cluster.items);
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

/** Последний непрерывный отрезок: каждая следующая операция — через `step` месяцев, без двух в одном месяце. */
function lastMonthRun(sorted: readonly HistoryOp[], step: number): HistoryOp[] {
  let run: HistoryOp[] = [];
  for (const op of sorted) {
    const prev = run.at(-1);
    if (prev === undefined || monthIndex(op.on) - monthIndex(prev.on) !== step) run = [op];
    else run.push(op);
  }
  return run;
}

interface Series {
  readonly period: RecurringPeriod;
  readonly ops: readonly HistoryOp[];
  readonly anchorDay: number | null;
}

function monthlySeries(
  sorted: readonly HistoryOp[],
  period: "month" | "quarter" | "year",
  s: DetectSettings,
): Series | undefined {
  const run = lastMonthRun(sorted, STEP_MONTHS[period]);
  const anchor = median(run.map((op) => dayOfMonth(op.on)));
  // С конца: пока дата в пределах допуска от дня серии (31-е в коротком месяце — его последний день).
  const kept: HistoryOp[] = [];
  for (const op of run.toReversed()) {
    const expected = Math.min(anchor, daysInMonth(monthIndex(op.on)));
    if (Math.abs(dayOfMonth(op.on) - expected) > s.dayTolerance) break;
    kept.unshift(op);
  }
  const need = period === "year" ? s.minRepeatsYear : s.minRepeats;
  return kept.length >= need ? { period, ops: kept, anchorDay: anchor } : undefined;
}

function weeklySeries(sorted: readonly HistoryOp[], s: DetectSettings): Series | undefined {
  const kept: HistoryOp[] = [];
  for (const op of sorted.toReversed()) {
    const next = kept[0];
    if (next === undefined) kept.unshift(op);
    else if (Math.abs(daysBetween(op.on, next.on) - 7) <= s.weekTolerance) kept.unshift(op);
    else break;
  }
  return kept.length >= s.minRepeats ? { period: "week", ops: kept, anchorDay: null } : undefined;
}

function findSeries(cluster: readonly HistoryOp[], s: DetectSettings): Series | undefined {
  const sorted = cluster.toSorted((a, b) => a.on.localeCompare(b.on) || a.id.localeCompare(b.id));
  return (
    weeklySeries(sorted, s) ??
    monthlySeries(sorted, "month", s) ??
    monthlySeries(sorted, "quarter", s) ??
    monthlySeries(sorted, "year", s)
  );
}

/** Следующая ожидаемая дата серии после последнего платежа. */
export function nextExpected(
  period: RecurringPeriod,
  last: LocalDate,
  anchorDay: number | null,
): LocalDate {
  if (period === "week" || anchorDay === null) return addDays(last, 7);
  return dayInMonth(monthIndex(last) + STEP_MONTHS[period], anchorDay);
}

/** REC-01: все регулярные серии истории; `today` нужен, чтобы не предлагать давно прекратившиеся. */
export function detect(
  history: readonly HistoryOp[],
  today: LocalDate,
  s: DetectSettings,
): Candidate[] {
  const groups = new Map<string, HistoryOp[]>();
  for (const op of history) {
    const key = `${op.flow}|${op.merchantKey}`;
    groups.set(key, [...(groups.get(key) ?? []), op]);
  }
  const found: Candidate[] = [];
  for (const group of groups.values()) {
    for (const cluster of clusterByAmount(group, s.amountTolerancePct)) {
      if (cluster.length < Math.min(s.minRepeats, s.minRepeatsYear)) continue;
      const series = findSeries(cluster, s);
      if (series === undefined) continue;
      const last = series.ops.at(-1);
      if (last === undefined) continue;
      if (daysBetween(last.on, today) > PERIOD_DAYS[series.period] * s.deadAfterPeriods) continue;
      found.push({
        merchantKey: last.merchantKey,
        merchantName: last.merchantName,
        flow: last.flow,
        period: series.period,
        occurrences: series.ops.slice(-s.window),
        memberIds: series.ops.map((op) => op.id),
        anchorDay: series.anchorDay,
        lastOccurredOn: last.on,
        nextExpectedOn: nextExpected(series.period, last.on, series.anchorDay),
        categoryCode: last.categoryCode,
        categoryId: last.categoryId,
      });
    }
  }
  return found.toSorted(
    (a, b) => a.merchantKey.localeCompare(b.merchantKey) || (a.anchorDay ?? 0) - (b.anchorDay ?? 0),
  );
}
