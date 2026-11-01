// Запросы weekly: первый аргумент — s: ScopedDb, у каждого обращения к таблице — свой s.own (ADR-0006). Обход «для всех» — один
// сквозной SELECT владельцев включённых сводок (`findOwners`, только id, household_id, user_id).
import { and, desc, eq } from "drizzle-orm";
import type { InsertValue, ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { SweepFind } from "../../../../platform/jobs/sweep.ts";
import { weeklyPreferences, weeklySummaries } from "./schema.ts";

export type PreferencesRow = typeof weeklyPreferences.$inferSelect;
export type SummaryRow = typeof weeklySummaries.$inferSelect;
export type NewSummary = InsertValue<typeof weeklySummaries>;

/** Настройки пользователя; строки нет — undefined (действуют общие умолчания). */
export async function findPreferences(s: ScopedDb): Promise<PreferencesRow | undefined> {
  const rows = await s.db.select().from(weeklyPreferences).where(s.own(weeklyPreferences));
  return rows[0];
}

/** Строка настроек по умолчанию, если её ещё нет: пользователь попадает в обход итогов недели. Повтор ничего не меняет. */
export async function ensurePreferences(s: ScopedDb): Promise<void> {
  await s
    .insert(weeklyPreferences)
    .values({})
    .onConflictDoNothing({ target: [weeklyPreferences.householdId, weeklyPreferences.userId] });
}

/** Записать настройки (строка одна на пользователя). */
export async function savePreferences(
  s: ScopedDb,
  value: { enabled: boolean; weekday: number; time: string },
): Promise<void> {
  await s
    .insert(weeklyPreferences)
    .values(value)
    .onConflictDoUpdate({
      target: [weeklyPreferences.householdId, weeklyPreferences.userId],
      set: value,
    });
}

/** Сводка за неделю, если уже есть (в том числе «пустая»). */
export async function findSummaryByWeek(
  s: ScopedDb,
  weekStart: string,
): Promise<SummaryRow | undefined> {
  const rows = await s.db
    .select()
    .from(weeklySummaries)
    .where(and(s.own(weeklySummaries), eq(weeklySummaries.weekStart, weekStart)));
  return rows[0];
}

/** Сводка недели; уже есть — ничего (повторный запуск и гонка двух задач безопасны). */
export async function insertSummary(s: ScopedDb, row: NewSummary): Promise<boolean> {
  const rows = await s
    .insert(weeklySummaries)
    .values(row)
    .onConflictDoNothing({
      target: [weeklySummaries.householdId, weeklySummaries.userId, weeklySummaries.weekStart],
    })
    .returning({ id: weeklySummaries.id });
  return rows.length > 0;
}

/** Готовые сводки, свежие сверху (без «пустых»). */
export async function listSummaries(s: ScopedDb, limit: number): Promise<SummaryRow[]> {
  return s.db
    .select()
    .from(weeklySummaries)
    .where(and(s.own(weeklySummaries), eq(weeklySummaries.status, "ok")))
    .orderBy(desc(weeklySummaries.weekStart))
    .limit(limit);
}

/** Владельцы включённых сводок: срок сверяет задача по часам под scope владельца (часы теста и боевые — не часы базы). */
export const findOwners: SweepFind = async (db) =>
  db
    .select({
      id: weeklyPreferences.id,
      householdId: weeklyPreferences.householdId,
      userId: weeklyPreferences.userId,
    })
    .from(weeklyPreferences)
    .where(eq(weeklyPreferences.enabled, true))
    .orderBy(weeklyPreferences.householdId, weeklyPreferences.userId);
