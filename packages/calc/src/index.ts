// Публичный API @kosht/calc — все числа P1/P2 (паспорт — packages/calc/CLAUDE.md).
export { node, type Calc, type NodeOptions } from "./calc.ts";
export { freeBalance, type FreeBalanceInput } from "./fin/free-balance.ts";
export {
  avg,
  mul,
  mulRate,
  round,
  sub,
  sum,
  type NonEmpty,
  type RoundingOptions,
} from "./money-ops.ts";
export type { RoundingMode, RoundingRule, RoundingUnit } from "./rounding.ts";
export { TRACE_KEYS, type TraceKey } from "./trace-keys.ts";
