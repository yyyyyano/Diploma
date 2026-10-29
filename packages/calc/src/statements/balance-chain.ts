// STMT-04 (шаг 3): сверка цепочки остатков выписки. Остаток на начало + операции периода должны дать остаток на конец;
// расхождение — «проверьте»: импорт не проходит молча. Знак операции — со стороны счёта: поступление «+», списание «−».
import type { Money } from "@kosht/kernel";
import type { Calc } from "../calc.ts";
import { sub, sum, type NonEmpty } from "../money-ops.ts";

export interface BalanceChainInput {
  /** Остаток на начало периода из выписки; ключ — `statements.openingBalance`. */
  readonly opening: Calc<Money>;
  /** Операции выписки со знаком счёта (поступление +, списание −); ключ каждой — `statements.operation`. */
  readonly operations: readonly Calc<Money>[];
  /** Остаток на конец периода из выписки; ключ — `statements.closingBalance`. */
  readonly closing: Calc<Money>;
}

/**
 * Расхождение = остаток на конец по выписке − (остаток на начало + операции). Ноль — цепочка сходится; любое другое
 * число — выписка разобрана неверно или в ней не все операции. Деньги в одной валюте (валюта счёта выписки).
 */
export function balanceChainDifference(input: BalanceChainInput): Calc<Money> {
  const expected = sum("statements.expectedClosing", [
    input.opening,
    ...input.operations,
  ] as NonEmpty<Calc<Money>>);
  return sub("statements.balanceDifference", input.closing, [expected]);
}
