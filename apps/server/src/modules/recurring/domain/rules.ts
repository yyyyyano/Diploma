// Правила регулярных платежей (REC-02, REC-04, REC-05) — чистые функции: раздел по категории, начальное состояние
// найденного, что входит в свободный остаток и когда платёж считается «возможно прекращён».
import type { RecurringPeriod } from "@kosht/calc";
import type { LocalDate } from "@kosht/kernel";
import { addDays } from "./dates.ts";
import { PERIOD_DAYS, type Flow } from "./detect.ts";

/** Разделы экрана: Доходы, Обязательные, Подписки, Другие регулярные (REC-02). */
export const SECTIONS = ["income", "mandatory", "subscriptions", "other"] as const;
export type Section = (typeof SECTIONS)[number];

/** Состояния платежа (REC-02, REC-05). */
export const STATES = ["active", "suggested", "maybe-ended", "ended", "excluded"] as const;
export type State = (typeof STATES)[number];

/** Категории обязательных платежей (REC-04): ЖКХ, аренда, связь, кредиты. */
const MANDATORY_CATEGORIES: ReadonlySet<string> = new Set([
  "utilities",
  "rent",
  "telecom",
  "loans",
]);

/** Раздел по умолчанию: доходы — «Доходы», подписки — по категории, обязательные — по категории, остальное — «Другие». */
export function sectionOf(flow: Flow, categoryCode: string | null): Section {
  if (flow === "income") return "income";
  if (categoryCode === "subscriptions") return "subscriptions";
  if (categoryCode !== null && MANDATORY_CATEGORIES.has(categoryCode)) return "mandatory";
  return "other";
}

/** Найденное в доходах, обязательных и подписках сразу действует, в «Других» — предположение (REC-02). */
export function initialState(section: Section): State {
  return section === "other" ? "suggested" : "active";
}

/** REC-04: входит ли платёж в свободный остаток — раздел доходов, обязательных или подписок и не прекращён. */
export function countsInFreeBalance(section: Section, state: State): boolean {
  return section !== "other" && (state === "active" || state === "maybe-ended");
}

export interface MissedWindow {
  /** Ежемесячные: столько дней после ожидаемой даты (REC-05: 10). */
  readonly monthlyDays: number;
  /** Остальные периоды: доля периода, % (по умолчанию 10). */
  readonly otherPercent: number;
}

/** REC-05: с какого дня платёж, не пришедший к ожидаемой дате, «возможно прекращён». */
export function missedFrom(
  expectedOn: LocalDate,
  period: RecurringPeriod,
  window: MissedWindow,
): LocalDate {
  const days =
    period === "month"
      ? window.monthlyDays
      : Math.max(1, Math.ceil((PERIOD_DAYS[period] * window.otherPercent) / 100));
  return addDays(expectedOn, days);
}
