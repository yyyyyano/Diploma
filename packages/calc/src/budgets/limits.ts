// BUD-01…03: лимит по категории на календарный месяц. Расходы месяца считает агрегат операций (`transactions/`), здесь —
// процент лимита и пороги уведомлений. Процент — целый, вниз: «80 %» показывается и уведомляет, только когда
// порог достигнут по-настоящему (159,99 из 200 — ещё 79 %).
import { Money } from "@kosht/kernel";
import { node, trace, type Calc } from "../calc.ts";

/** Процент `part` от `whole`, вниз до целого; отрицательная часть — 0 (возвратов больше покупок). */
export function percentOf(key: string, part: Calc<Money>, whole: Calc<Money>): Calc<number> {
  if (whole.value.minor <= 0) {
    throw new RangeError(
      `${key}: делить на ${String(whole.value.minor)} нельзя — лимит или цель больше нуля.`,
    );
  }
  const numerator = BigInt(Math.max(0, part.value.minor)) * 100n;
  const value = Number(numerator / BigInt(whole.value.minor));
  return {
    value,
    trace: trace(
      key,
      "round",
      value,
      [part.trace, whole.trace],
      [],
      "rounding=floor step=1; сумма × 100 ÷ лимит",
    ),
  };
}

/** BUD-02: процент лимита = расходы месяца × 100 ÷ лимит; расходы — расчёт агрегата с операциями-основаниями. */
export function limitPercent(spent: Calc<Money>, limit: Money): Calc<number> {
  return percentOf("budgets.limitPercent", spent, node("budgets.limit", limit));
}

/** BUD-03, BUD-07: какие из порогов (в процентах) уже достигнуты при данном проценте, по возрастанию порога. */
export function reachedThresholds(percent: number, thresholds: readonly number[]): number[] {
  return thresholds.filter((threshold) => percent >= threshold).toSorted((a, b) => a - b);
}
