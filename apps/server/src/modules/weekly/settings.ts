// Настройки weekly (WEEK-02, WEEK-03, NFR-23): день и время сводки по умолчанию (у пользователя — свои, в `weekly_preferences`),
// сколько прошлых недель берётся в «обычные траты». Меняются без правки кода.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** День недели сводки по умолчанию: 1 — понедельник (WEEK-01). */
export const DEFAULT_WEEKDAY = defineSetting({
  key: "weekly.default-weekday",
  schema: z.int().min(1).max(7),
  default: 1,
});

/** Время отправки по умолчанию «чч:мм» по поясу системы (WEEK-01). */
export const DEFAULT_TIME = defineSetting({
  key: "weekly.default-time",
  schema: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
  default: "09:00",
});

/** Сколько прошлых недель берётся для сравнения трат (WEEK-02). */
export const AVERAGE_WEEKS = defineSetting({
  key: "weekly.average-weeks",
  schema: z.int().min(2).max(26),
  default: 8,
});

export const WEEKLY_SETTINGS = [DEFAULT_WEEKDAY, DEFAULT_TIME, AVERAGE_WEEKS] as const;
