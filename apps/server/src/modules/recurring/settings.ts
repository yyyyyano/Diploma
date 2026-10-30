// Пороги поиска регулярных (REC-01, REC-05): подбираются на демо-данных и реальных выписках, поэтому настройки, а не
// константы. Значения по умолчанию — из SPEC REC-01 и REC-05.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** REC-01: не меньше стольких повторов подряд. */
export const MIN_REPEATS = defineSetting({
  key: "recurring.min-repeats",
  schema: z.int().min(2).max(12),
  default: 3,
});

/** REC-01: для ежегодных платежей — повторов (по умолчанию 2). */
export const MIN_REPEATS_YEAR = defineSetting({
  key: "recurring.min-repeats-year",
  schema: z.int().min(2).max(6),
  default: 2,
});

/** REC-01: отклонение суммы от среднего серии, процентов. */
export const AMOUNT_TOLERANCE_PCT = defineSetting({
  key: "recurring.amount-tolerance-pct",
  schema: z.int().min(0).max(100),
  default: 15,
});

/** REC-01: отклонение даты для ежемесячных, квартальных и годовых, дней. */
export const DAY_TOLERANCE = defineSetting({
  key: "recurring.day-tolerance-days",
  schema: z.int().min(0).max(15),
  default: 5,
});

/** REC-01: отклонение интервала для еженедельных, дней. */
export const WEEK_TOLERANCE = defineSetting({
  key: "recurring.week-tolerance-days",
  schema: z.int().min(0).max(3),
  default: 1,
});

/** Сколько последних повторов серии идёт в основание средней суммы. */
export const WINDOW = defineSetting({
  key: "recurring.window",
  schema: z.int().min(2).max(24),
  default: 6,
});

/** Глубина истории поиска, месяцев (годовой платёж с двумя повторами виден за 13 месяцев). */
export const HISTORY_MONTHS = defineSetting({
  key: "recurring.history-months",
  schema: z.int().min(6).max(36),
  default: 13,
});

/** REC-05: ежемесячный платёж «возможно прекращён» через столько дней после ожидаемой даты. */
export const MISSED_DAYS = defineSetting({
  key: "recurring.missed-days",
  schema: z.int().min(1).max(60),
  default: 10,
});

/** REC-05: для остальных периодов — доля периода после ожидаемой даты, процентов. */
export const MISSED_PERCENT = defineSetting({
  key: "recurring.missed-percent",
  schema: z.int().min(1).max(50),
  default: 10,
});

export const RECURRING_SETTINGS = [
  MIN_REPEATS,
  MIN_REPEATS_YEAR,
  AMOUNT_TOLERANCE_PCT,
  DAY_TOLERANCE,
  WEEK_TOLERANCE,
  WINDOW,
  HISTORY_MONTHS,
  MISSED_DAYS,
  MISSED_PERCENT,
] as const;
