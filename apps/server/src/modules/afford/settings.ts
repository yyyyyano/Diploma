// Настройки afford (AFF-03, NFR-23): на сколько дней вперёд считать прогноз остатка. Умолчание — из SPEC («2–3 месяца»);
// меняется без правки кода.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** AFF-03: горизонт прогноза остатка по дням — три месяца (сегодня и 90 следующих дней). */
export const AFFORD_HORIZON_DAYS = defineSetting({
  key: "afford.horizon-days",
  schema: z.int().min(30).max(180),
  default: 90,
});

export const AFFORD_SETTINGS = [AFFORD_HORIZON_DAYS] as const;
