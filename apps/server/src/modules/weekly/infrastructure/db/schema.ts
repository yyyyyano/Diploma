// Таблицы weekly (WEEK-01…03, ARCHITECTURE §6.1) — userOwnedTable. `weekly_preferences` — настройки пользователя (по строке на
// пользователя; нет значения — действует общее умолчание из настроек системы) и список владельцев для обхода; `weekly_summaries` —
// история сводок: одна на неделю (уникальность по `week_start` делает повторный запуск безопасным). Числа сводки с traceId лежат
// в `facts` готовыми — как были показаны человеку (EXPL-02), текст — отдельно, с признаком «модель или шаблон».
import { sql } from "drizzle-orm";
import { boolean, check, date, jsonb, smallint, text, uniqueIndex } from "drizzle-orm/pg-core";
import { userOwnedTable } from "../../../../platform/db/tables.ts";

export const SUMMARY_STATUSES = ["ok", "empty"] as const;
export const TEXT_SOURCES = ["model", "template"] as const;

export const weeklyPreferences = userOwnedTable(
  "weekly_preferences",
  {
    enabled: boolean().notNull().default(true),
    /** День недели: 1 — понедельник … 7 — воскресенье; null — общее умолчание. */
    weekday: smallint(),
    /** Время «чч:мм» по поясу системы; null — общее умолчание. */
    time: text(),
  },
  (t) => [
    uniqueIndex("weekly_preferences_owner_idx").on(t.householdId, t.userId),
    check(
      "weekly_preferences_weekday_check",
      sql`${t.weekday} is null or ${t.weekday} between 1 and 7`,
    ),
    check(
      "weekly_preferences_time_check",
      sql`${t.time} is null or ${t.time} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
  ],
);

export const weeklySummaries = userOwnedTable(
  "weekly_summaries",
  {
    /** Понедельник недели, за которую сводка. */
    weekStart: date({ mode: "string" }).notNull(),
    /** `empty` — за эту неделю и раньше операций нет: сводки нет, но неделя отмечена как обработанная. */
    status: text().notNull().default("ok"),
    /** Числа сводки с traceId, категории и лимиты словами — как показаны человеку. */
    facts: jsonb().$type<Record<string, unknown>>(),
    text: text().notNull().default(""),
    textSource: text().notNull().default("template"),
  },
  (t) => [
    uniqueIndex("weekly_summaries_week_idx").on(t.householdId, t.userId, t.weekStart),
    check("weekly_summaries_status_check", sql`${t.status} in ('ok', 'empty')`),
    check("weekly_summaries_source_check", sql`${t.textSource} in ('model', 'template')`),
  ],
);
