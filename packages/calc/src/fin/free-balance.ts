// FIN-20, EXPL-01: свободный остаток с разбивкой «2 400 − 180 − 35 − 1 200 − 145 = 840 BYN».
import type { Money } from "@kosht/kernel";
import type { Calc } from "../calc.ts";
import { sub } from "../money-ops.ts";

export interface FreeBalanceInput {
  /** Средний регулярный доход за последние полные месяцы (FIN-21), со своей трассой; ключ — `fin.averageIncome`. */
  readonly averageIncome: Calc<Money>;
  /**
   * Средние обязательные платежи по группам; каждый — слагаемое разбивки с ключом `fin.obligation.<группа>`
   * (utilities, communication, loan, subscriptions — TRACE_KEYS).
   */
  readonly averageObligations: readonly Calc<Money>[];
}

/** FIN-20: свободный остаток = средний регулярный доход − средние обязательные платежи; может быть отрицательным. */
export function freeBalance(input: FreeBalanceInput): Calc<Money> {
  return sub("fin.freeBalance", input.averageIncome, input.averageObligations);
}

/** Результат FIN-20 с историей: за сколько месяцев посчитано; нет истории — `null` и причина, а не ноль. */
export type FreeBalanceResult =
  | { readonly months: number; readonly balance: Calc<Money>; readonly reason?: undefined }
  | { readonly months: 0; readonly balance: null; readonly reason: "insufficient-history" };

/**
 * FIN-20: «по данным за N мес.» — N полных месяцев истории (не больше трёх). Нет ни одного полного месяца —
 * свободного остатка нет (`null`, `insufficient-history`): ноль выглядел бы как «денег не остаётся».
 */
export function freeBalanceForMonths(months: number, input: FreeBalanceInput): FreeBalanceResult {
  if (months <= 0) return { months: 0, balance: null, reason: "insufficient-history" };
  return { months, balance: freeBalance(input) };
}
