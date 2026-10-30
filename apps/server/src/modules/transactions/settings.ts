// Настройки сопоставления чека и выписки (TXN-10): окно дат, допуск суммы, порог похожести магазина. Подбираются на демо- и
// реальных данных, поэтому настройки, а не константы.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** Окно дат, дней: платёж по карте проходит не обязательно в день чека (TXN-10: ±2 дня). */
export const MATCH_WINDOW_DAYS = defineSetting({
  key: "transactions.match-window-days",
  schema: z.int().min(0).max(14),
  default: 2,
});

/** Допуск суммы чека и платежа, копейки (TXN-10: точность 0,01). */
export const MATCH_AMOUNT_TOLERANCE_MINOR = defineSetting({
  key: "transactions.match-amount-tolerance-minor",
  schema: z.int().min(0).max(100),
  default: 1,
});

/** Порог похожести названия магазина чека и контрагента выписки, 0…100: не ниже — «уверенный» кандидат. */
export const MATCH_SIMILARITY = defineSetting({
  key: "transactions.match-similarity",
  schema: z.int().min(0).max(100),
  default: 60,
});
