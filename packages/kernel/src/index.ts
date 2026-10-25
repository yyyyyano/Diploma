// Публичный API @kosht/kernel — общие примитивы (паспорт — packages/kernel/CLAUDE.md).
export type { Clock } from "./clock.ts";
export { FileId, HouseholdId, TraceId, UserId } from "./ids.ts";
export { DEFAULT_TIME_ZONE, LocalDate, type TimeZone } from "./local-date.ts";
export { CurrencyMismatchError, Money, type CurrencyCode } from "./money.ts";
export { Period } from "./period.ts";
export { makeScope, type Scope } from "./scope.ts";
export type { TraceNode, TraceOp, TraceRef, TraceValue } from "./trace.ts";
