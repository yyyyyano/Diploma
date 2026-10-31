// Настройки legal-consult (LEGAL-03): порог «длинной» цитаты без метки рядом. Пороги — настройками, не константами в коде.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/**
 * Цитата в кавычках без метки рядом, не короче стольких слов, считается цитатой закона и проверяется на дословность по версиям
 * из этого ответа; короче — название или термин, остаётся как есть. Цитата прямо перед меткой проверяется всегда.
 */
export const FREE_QUOTE_MIN_WORDS = defineSetting({
  key: "legal-consult.free-quote-min-words",
  schema: z.int().min(3).max(30),
  default: 6,
});

export const LEGAL_CONSULT_SETTINGS = [FREE_QUOTE_MIN_WORDS] as const;
