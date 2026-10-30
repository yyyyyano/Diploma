// FIN-01: агрегаты по операциям — числа считает код. Сумма копеек группы приходит из SQL (`SUM` в bigint), здесь она
// становится узлом трассы с операциями-основаниями (не больше `maxRefs`, остальное — в пояснении) и складывается
// помощниками calc. Переводы в доходы и расходы не входят; возврат уменьшает расходы своей категории (категории покупки).
import { Money } from "@kosht/kernel";
import { node, type Calc } from "../calc.ts";
import { sub, sum } from "../money-ops.ts";

/** Сумма группы из SQL: копейки BYN, число операций и id операций-оснований (первые по порядку). */
export interface GroupSum {
  readonly minor: number;
  readonly count: number;
  readonly ids: readonly string[];
}

const BYN = "BYN";

/** Лист трассы суммы группы: основания — операции до `maxRefs`, число остальных — в пояснении. */
export function groupSum(key: string, group: GroupSum, maxRefs: number): Calc<Money> {
  const refs = group.ids.slice(0, maxRefs).map((id) => ({ kind: "transaction" as const, id }));
  const rest = group.count - refs.length;
  return node(key, Money.of(group.minor, BYN), {
    refs,
    ...(rest > 0 ? { note: `ещё ${String(rest)} операций` } : {}),
  });
}

/** Сумма слагаемых или ноль BYN, если слагаемых нет (период без операций — ноль, а не ошибка). */
export function totalOf(key: string, parts: readonly Calc<Money>[]): Calc<Money> {
  const [first, ...rest] = parts;
  return first === undefined ? node(key, Money.of(0, BYN)) : sum(key, [first, ...rest]);
}

/**
 * FIN-01: расходы категории (или месяца, или контрагента) = покупки − возвраты; возвратов больше покупок — отрицательная
 * сумма как есть. Без возвратов — сами покупки, под своим ключом.
 */
export function categoryTotal(expense: Calc<Money>, refund: Calc<Money> | undefined): Calc<Money> {
  return sub("transactions.categoryTotal", expense, refund === undefined ? [] : [refund]);
}
