// Calc<T> (P1, P2, ADR-0017): каждое число расчёта несёт трассу «как получено». Листья трассы — node, узлы —
// помощники money-ops.ts; explain сохраняет трассу рядом с результатом (EXPL-02).
import { Money, type TraceNode, type TraceOp, type TraceRef, type TraceValue } from "@kosht/kernel";

/** Результат расчёта: значение и трасса, из которой сайт рисует «Откуда эта цифра?». */
export interface Calc<T extends TraceValue> {
  readonly value: T;
  readonly trace: TraceNode;
}

export interface NodeOptions {
  /** Основания: операции, версии фрагментов норм, курсы. */
  readonly refs?: readonly TraceRef[];
  readonly note?: string;
}

/**
 * P2: исходное значение расчёта — лист трассы (средний доход, ставка из norm-tables, количество из чека).
 * Деньги проверяются как в `Money.of`, число — только целое в безопасном диапазоне (без float): иначе `RangeError`.
 */
export function node<T extends TraceValue>(
  key: string,
  value: T,
  options: NodeOptions = {},
): Calc<T> {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(
        `${key}: число трассы — целое (ставка в базисных пунктах, количество), получено ${value}.`,
      );
    }
  } else {
    Money.of(value.minor, value.currency);
  }
  return {
    value,
    trace: trace(key, "value", value, [], options.refs ?? [], options.note),
  };
}

/** Узел трассы; `note` пишется, только если есть (exactOptionalPropertyTypes). */
export function trace(
  key: string,
  op: TraceOp,
  value: TraceValue,
  inputs: readonly TraceNode[],
  refs: readonly TraceRef[] = [],
  note?: string,
): TraceNode {
  return note === undefined
    ? { key, op, value, inputs, refs }
    : { key, op, value, inputs, refs, note };
}
