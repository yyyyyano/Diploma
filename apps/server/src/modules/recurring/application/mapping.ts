// Платёж → DTO для сайта (DTO ≠ строка БД): деньги — Money, расчётные числа несут трассу через recurring.explain.
import { RecurringId, type RecurringItem } from "@kosht/contract";
import type { RecurringEntry } from "./view.ts";

export function toDto(entry: RecurringEntry): RecurringItem {
  return {
    id: RecurringId.parse(entry.id),
    name: entry.name,
    flow: entry.flow,
    section: entry.section,
    period: entry.period,
    state: entry.state,
    source: entry.source,
    anchorDay: entry.anchorDay,
    amount: entry.average.value,
    amountIsManual: entry.amountIsManual,
    amountRange: entry.amountRange,
    monthly: entry.monthly.value,
    nextExpectedOn: entry.nextExpectedOn,
    lastOccurredOn: entry.lastOccurredOn,
    overdueDays: entry.overdueDays,
    repeats: entry.repeats,
    categoryCode: entry.categoryCode,
    categoryId: entry.categoryId,
    counted: entry.counted,
  };
}
