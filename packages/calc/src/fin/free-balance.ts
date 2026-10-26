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
