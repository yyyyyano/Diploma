// Настройки fx-rates (STMT-09): сколько дней назад искать установленный курс (выходные, праздники) и таймаут запроса
// к НБРБ — настройки, а не константы: админка меняет их без перезапуска.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** Сколько дней назад искать курс, если на запрошенный день его нет (выходной — последний установленный). */
export const LOOKBACK_DAYS = defineSetting({
  key: "fx-rates.lookback-days",
  schema: z.int().min(1).max(31),
  default: 7,
});

/** Таймаут одного запроса к API НБРБ, мс. */
export const NBRB_TIMEOUT_MS = defineSetting({
  key: "fx-rates.timeout-ms",
  schema: z.int().min(500).max(30_000),
  default: 5_000,
});
