// Трасса расчёта (P2, EXPL-01/02, ADR-0017): дерево «как получено число». Строит её только @kosht/calc
// (помощники node/sum/sub/mul/avg/round); explain хранит её рядом с результатом, сайт рисует
// «2 400 − 180 − 35 − 1 200 − 145 = 840 BYN». Тип — здесь, потому что его читают calc, contract и сайт.
import type { Money } from "./money.ts";

/**
 * Действие узла: «value» — исходное значение (лист), остальные — помощники calc с тем же именем
 * (`mulRate` → `mul`).
 */
export type TraceOp = "value" | "sum" | "sub" | "mul" | "avg" | "round";

/** Значение узла: деньги или целое (количество, ставка в базисных пунктах — 1300 = 13 %). */
export type TraceValue = Money | number;

/** Основание числа: операция, версия фрагмента нормы (`fragmentVersionId`), курс валюты. */
export interface TraceRef {
  readonly kind: "transaction" | "fragmentVersion" | "fxRate";
  readonly id: string;
}

export interface TraceNode {
  /** Ключ подписи из словаря formulas (`fin.freeBalance`). */
  readonly key: string;
  readonly op: TraceOp;
  readonly value: TraceValue;
  /** Узлы-аргументы в порядке формулы: у `sub` первый — уменьшаемое. */
  readonly inputs: readonly TraceNode[];
  readonly refs: readonly TraceRef[];
  /** Пояснение: правило и шаг округления, ставка и т. п. */
  readonly note?: string;
}
