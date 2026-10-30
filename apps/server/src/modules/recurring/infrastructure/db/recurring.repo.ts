// Запросы к recurring_items и recurring_revisions: первый аргумент — s: ScopedDb, у каждого обращения свой s.own
// (ADR-0006). Строки, которые меняет сценарий, читаем FOR UPDATE в порядке id: параллельные пересчёты идут по очереди.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { InsertValue, Patch, ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { SweepFind } from "../../../../platform/jobs/sweep.ts";
import { recurringItems, recurringRevisions } from "./schema.ts";

export type ItemRow = typeof recurringItems.$inferSelect;
export type NewItem = InsertValue<typeof recurringItems>;
export type RevisionRow = typeof recurringRevisions.$inferSelect;
export type NewRevision = InsertValue<typeof recurringRevisions>;

/** Повтор-основание средней суммы: операция, её день и сумма в BYN (копейки). */
export interface StoredOccurrence {
  readonly id: string;
  readonly on: string;
  readonly minor: number;
}

export async function listItems(s: ScopedDb): Promise<ItemRow[]> {
  return s.db
    .select()
    .from(recurringItems)
    .where(s.own(recurringItems))
    .orderBy(asc(recurringItems.nextExpectedOn), asc(recurringItems.id));
}

/** Все платежи пользователя под блокировкой: пересчёт и действия человека идут по очереди. */
export async function lockAll(s: ScopedDb): Promise<ItemRow[]> {
  return s.db
    .select()
    .from(recurringItems)
    .where(s.own(recurringItems))
    .orderBy(asc(recurringItems.id))
    .for("update");
}

export async function lockItem(s: ScopedDb, id: string): Promise<ItemRow | undefined> {
  const rows = await s.db
    .select()
    .from(recurringItems)
    .where(and(s.own(recurringItems), eq(recurringItems.id, id)))
    .for("update");
  return rows[0];
}

/** Серия новая — id; такая уже есть (параллельный поиск) — undefined. */
export async function insertItem(s: ScopedDb, item: NewItem): Promise<string | undefined> {
  const rows = await s
    .insert(recurringItems)
    .values(item)
    .onConflictDoNothing({
      target: [recurringItems.householdId, recurringItems.userId, recurringItems.seriesKey],
    })
    .returning({ id: recurringItems.id });
  return rows[0]?.id;
}

export async function updateItem(
  s: ScopedDb,
  id: string,
  patch: Patch<typeof recurringItems>,
  at: Date,
): Promise<void> {
  await s.update(recurringItems, eq(recurringItems.id, id)).set({ ...patch, updatedAt: at });
}

export async function deleteItem(s: ScopedDb, id: string): Promise<void> {
  await s.delete(recurringItems, eq(recurringItems.id, id));
}

export async function insertRevision(s: ScopedDb, revision: NewRevision): Promise<string> {
  const rows = await s
    .insert(recurringRevisions)
    .values(revision)
    .returning({ id: recurringRevisions.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("recurring_revisions: вставка не вернула id.");
  return id;
}

export async function findRevision(s: ScopedDb, id: string): Promise<RevisionRow | undefined> {
  const rows = await s.db
    .select()
    .from(recurringRevisions)
    .where(and(s.own(recurringRevisions), eq(recurringRevisions.id, id)));
  return rows[0];
}

/** REC-02: какие из этих операций входят в действующий регулярный платёж (не исключённый и не предложенный «не тот»). */
export async function markedOperations(s: ScopedDb, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await s.db
    .select({ members: recurringItems.memberIds })
    .from(recurringItems)
    .where(
      and(
        s.own(recurringItems),
        inArray(recurringItems.state, ["active", "suggested", "maybe-ended"]),
        sql`${recurringItems.memberIds} && array[${list}]`,
      ),
    );
  const wanted = new Set(ids);
  return [...new Set(rows.flatMap((row) => row.members.filter((id) => wanted.has(id))))];
}

/**
 * Сквозной поиск для ежедневного обхода (REC-05): платежи, найденные по истории и действующие. Дату проверяет задача
 * по часам под scope владельца — сквозной запрос времени не знает.
 */
export const findActiveDetected: SweepFind = async (db) =>
  db
    .select({
      id: recurringItems.id,
      householdId: recurringItems.householdId,
      userId: recurringItems.userId,
    })
    .from(recurringItems)
    .where(and(eq(recurringItems.state, "active"), eq(recurringItems.source, "detected")));
