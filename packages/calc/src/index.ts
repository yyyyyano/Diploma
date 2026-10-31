// Публичный API @kosht/calc — все числа P1/P2 (паспорт — packages/calc/CLAUDE.md).
export { node, type Calc, type NodeOptions } from "./calc.ts";
export { toByn, type FxRateInput } from "./fx/to-byn.ts";
export { balanceChainDifference, type BalanceChainInput } from "./statements/balance-chain.ts";
export {
  allocate,
  splitByCategory,
  type CategorySplit,
  type SplitLine,
} from "./receipts/split-by-category.ts";
export {
  validateReceipt,
  type LineValidation,
  type ReceiptInput,
  type ReceiptLineInput,
  type ReceiptValidation,
  type TotalValidation,
} from "./receipts/validate-receipt.ts";
export {
  monthlyAmount,
  monthlyTotal,
  recurringAverage,
  type Occurrence,
  type RecurringPeriod,
} from "./recurring/recurring-amounts.ts";
export { limitPercent, percentOf, reachedThresholds } from "./budgets/limits.ts";
export {
  goalBehind,
  goalPercent,
  goalPlanned,
  monthsLeft,
  recommendedContribution,
} from "./budgets/goals.ts";
export { categoryTotal, groupSum, totalOf, type GroupSum } from "./transactions/aggregate.ts";
export {
  freeBalance,
  freeBalanceForMonths,
  type FreeBalanceInput,
  type FreeBalanceResult,
} from "./fin/free-balance.ts";
export { FREE_BALANCE_MONTHS, historyMonths, historyWindow, monthEnd } from "./fin/history.ts";
export { forecastBalances, type ExpectedPayment, type ForecastDay } from "./fin/forecast.ts";
export {
  avg,
  mul,
  mulQuantity,
  mulRate,
  round,
  sub,
  sum,
  type NonEmpty,
  type RoundingOptions,
} from "./money-ops.ts";
export type { RoundingMode, RoundingRule, RoundingUnit } from "./rounding.ts";
export { dayCount, ratioPercent, scaleMoney, type ScaleOptions } from "./calculator/calculator.ts";
export { TRACE_KEYS, type TraceKey } from "./trace-keys.ts";
