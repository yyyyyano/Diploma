// Запросы budgets: первый аргумент — s: ScopedDb, у каждого обращения свой s.own (ADR-0006). Строки, которые меняет
// сценарий, читаются FOR UPDATE: «Отменить», правка и пересчёт порогов идут по очереди.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { InsertValue, Patch, ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { SweepFind } from "../../../../platform/jobs/sweep.ts";
import {
  budgetAlerts,
  budgetContributions,
  budgetGoals,
  budgetLimits,
  budgetRevisions,
} from "./schema.ts";

/** Поля лимита или цели до действия человека (ревизия). */
export type RevisionSnapshot = Record<string, string | number | boolean | null>;

export type LimitRow = typeof budgetLimits.$inferSelect;
export type NewLimit = InsertValue<typeof budgetLimits>;
export type GoalRow = typeof budgetGoals.$inferSelect;
export type NewGoal = InsertValue<typeof budgetGoals>;
export type ContributionRow = typeof budgetContributions.$inferSelect;
export type RevisionRow = typeof budgetRevisions.$inferSelect;
export type NewRevision = InsertValue<typeof budgetRevisions>;

/** Единственная строка `INSERT … RETURNING` / `SELECT count(*)`: пусто — сбой базы, а не ответ пользователю. */
export function oneRow<T>(rows: readonly T[], what: string): T {
  const [row] = rows;
  if (row === undefined) throw new Error(`${what}: запрос не вернул строку.`);
  return row;
}

export async function listLimits(s: ScopedDb): Promise<LimitRow[]> {
  return s.db
    .select()
    .from(budgetLimits)
    .where(s.own(budgetLimits))
    .orderBy(asc(budgetLimits.createdAt), asc(budgetLimits.id));
}

export async function lockLimit(s: ScopedDb, id: string): Promise<LimitRow | undefined> {
  const rows = await s.db
    .select()
    .from(budgetLimits)
    .where(and(s.own(budgetLimits), eq(budgetLimits.id, id)))
    .for("update");
  return rows[0];
}

export async function lockLimitByCategory(
  s: ScopedDb,
  categoryKey: string,
): Promise<LimitRow | undefined> {
  const rows = await s.db
    .select()
    .from(budgetLimits)
    .where(and(s.own(budgetLimits), eq(budgetLimits.categoryKey, categoryKey)))
    .for("update");
  return rows[0];
}

/** Новый лимит — id; лимит категории уже есть (параллельный запрос) — `undefined`. */
export async function insertLimit(s: ScopedDb, limit: NewLimit): Promise<string | undefined> {
  const rows = await s
    .insert(budgetLimits)
    .values(limit)
    .onConflictDoNothing({
      target: [budgetLimits.householdId, budgetLimits.userId, budgetLimits.categoryKey],
    })
    .returning({ id: budgetLimits.id });
  return rows[0]?.id;
}

export async function updateLimit(
  s: ScopedDb,
  id: string,
  patch: Patch<typeof budgetLimits>,
  at: Date,
): Promise<void> {
  await s.update(budgetLimits, eq(budgetLimits.id, id)).set({ ...patch, updatedAt: at });
}

/** Лимит и его одноразовые уведомления — вместе: после «Да» или «Отменить» создания следов не остаётся. */
export async function deleteLimit(s: ScopedDb, id: string): Promise<void> {
  await s.delete(budgetAlerts, eq(budgetAlerts.subjectId, id));
  await s.delete(budgetLimits, eq(budgetLimits.id, id));
}

export async function listGoals(s: ScopedDb): Promise<GoalRow[]> {
  return s.db
    .select()
    .from(budgetGoals)
    .where(s.own(budgetGoals))
    .orderBy(asc(budgetGoals.deadline), asc(budgetGoals.id));
}

export async function lockGoal(s: ScopedDb, id: string): Promise<GoalRow | undefined> {
  const rows = await s.db
    .select()
    .from(budgetGoals)
    .where(and(s.own(budgetGoals), eq(budgetGoals.id, id)))
    .for("update");
  return rows[0];
}

export async function insertGoal(s: ScopedDb, goal: NewGoal): Promise<string> {
  const rows = await s.insert(budgetGoals).values(goal).returning({ id: budgetGoals.id });
  return oneRow(rows, "budget_goals").id;
}

export async function updateGoal(
  s: ScopedDb,
  id: string,
  patch: Patch<typeof budgetGoals>,
  at: Date,
): Promise<void> {
  await s.update(budgetGoals, eq(budgetGoals.id, id)).set({ ...patch, updatedAt: at });
}

/** Цель, её взносы (каскадом по ссылке) и одноразовые уведомления. */
export async function deleteGoal(s: ScopedDb, id: string): Promise<void> {
  await s.delete(budgetAlerts, eq(budgetAlerts.subjectId, id));
  await s.delete(budgetGoals, eq(budgetGoals.id, id));
}

export async function insertContribution(
  s: ScopedDb,
  input: { goalId: string; amountMinor: number; madeOn: string },
): Promise<string> {
  const rows = await s
    .insert(budgetContributions)
    .values(input)
    .returning({ id: budgetContributions.id });
  return oneRow(rows, "budget_contributions").id;
}

export async function deleteContribution(s: ScopedDb, id: string): Promise<void> {
  await s.delete(budgetContributions, eq(budgetContributions.id, id));
}

export async function countContributions(s: ScopedDb, goalId: string): Promise<number> {
  const rows = await s.db
    .select({ n: sql<number>`count(*)::int` })
    .from(budgetContributions)
    .where(and(s.own(budgetContributions), eq(budgetContributions.goalId, goalId)));
  return oneRow(rows, "budget_contributions").n;
}

/** Сумма взносов каждой копилки, копейки: одним запросом на все цели. */
export async function contributionSums(s: ScopedDb): Promise<Map<string, number>> {
  const rows = await s.db
    .select({
      goalId: budgetContributions.goalId,
      minor: sql<string>`sum(${budgetContributions.amountMinor})::text`,
    })
    .from(budgetContributions)
    .where(s.own(budgetContributions))
    .groupBy(budgetContributions.goalId);
  return new Map(rows.map((row) => [row.goalId, Number(row.minor)]));
}

/** Последние взносы целей: по `per` на цель, новые первыми (запрос один — окно по цели). */
export async function recentContributions(
  s: ScopedDb,
  goalIds: readonly string[],
  per: number,
): Promise<ContributionRow[]> {
  if (goalIds.length === 0) return [];
  const ranked = s.db
    .select({
      id: budgetContributions.id,
      rank: sql<number>`row_number() over (partition by ${budgetContributions.goalId} order by ${budgetContributions.madeOn} desc, ${budgetContributions.id} desc)`.as(
        "rank",
      ),
    })
    .from(budgetContributions)
    .where(and(s.own(budgetContributions), inArray(budgetContributions.goalId, [...goalIds])))
    .as("ranked");
  const ids = s.db
    .select({ id: ranked.id })
    .from(ranked)
    .where(sql`${ranked.rank} <= ${per}`);
  return s.db
    .select()
    .from(budgetContributions)
    .where(and(s.own(budgetContributions), inArray(budgetContributions.id, ids)))
    .orderBy(desc(budgetContributions.madeOn), desc(budgetContributions.id));
}

/**
 * Одноразовое уведомление: `true` — ключ новый (его и отправляем), `false` — уже было. Вставка `ON CONFLICT DO NOTHING`
 * вызывается в той же транзакции, что и `notify` (BUD-03: один раз на порог в месяц).
 */
export async function claimAlert(
  s: ScopedDb,
  subjectId: string,
  alertKey: string,
): Promise<boolean> {
  const rows = await s
    .insert(budgetAlerts)
    .values({ subjectId, alertKey })
    .onConflictDoNothing({
      target: [
        budgetAlerts.householdId,
        budgetAlerts.userId,
        budgetAlerts.subjectId,
        budgetAlerts.alertKey,
      ],
    })
    .returning({ id: budgetAlerts.id });
  return rows.length > 0;
}

export async function insertRevision(s: ScopedDb, revision: NewRevision): Promise<string> {
  const rows = await s
    .insert(budgetRevisions)
    .values(revision)
    .returning({ id: budgetRevisions.id });
  return oneRow(rows, "budget_revisions").id;
}

export async function findRevision(s: ScopedDb, id: string): Promise<RevisionRow | undefined> {
  const rows = await s.db
    .select()
    .from(budgetRevisions)
    .where(and(s.own(budgetRevisions), eq(budgetRevisions.id, id)));
  return rows[0];
}

/** Сквозной поиск для ежедневного обхода (BUD-07): владельцы целей; «отстаёт» ли — решает задача по часам под scope. */
export const findGoalOwners: SweepFind = async (db) =>
  db
    .select({
      id: budgetGoals.id,
      householdId: budgetGoals.householdId,
      userId: budgetGoals.userId,
    })
    .from(budgetGoals);
