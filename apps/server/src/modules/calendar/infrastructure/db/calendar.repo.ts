// Запросы календаря (CAL-01…07): первый аргумент — s: ScopedDb, у каждого обращения к таблице — свой s.own (ADR-0006).
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { InsertValue, ScopedDb } from "../../../../platform/db/scoped-db.ts";
import type { SweepFind } from "../../../../platform/jobs/sweep.ts";
import { calendarEvents, calendarReminders } from "./schema.ts";

export type EventRow = typeof calendarEvents.$inferSelect;
export type NewEvent = InsertValue<typeof calendarEvents>;
export type ReminderRow = typeof calendarReminders.$inferSelect;

/** Событие, если такого ключа ещё нет (ON CONFLICT DO NOTHING): id новой строки или `undefined`, если уже было. */
export async function insertEvent(s: ScopedDb, row: NewEvent): Promise<string | undefined> {
  const insert = s.insert(calendarEvents).values(row);
  const rows =
    row.key === undefined || row.key === null
      ? await insert.returning({ id: calendarEvents.id })
      : await insert
          .onConflictDoNothing({
            target: [calendarEvents.householdId, calendarEvents.userId, calendarEvents.key],
          })
          .returning({ id: calendarEvents.id });
  return rows[0]?.id;
}

export async function findEvent(s: ScopedDb, id: string): Promise<EventRow | undefined> {
  const rows = await s.db
    .select()
    .from(calendarEvents)
    .where(and(s.own(calendarEvents), eq(calendarEvents.id, id)))
    .for("update");
  return rows[0];
}

export async function findByKey(s: ScopedDb, key: string): Promise<EventRow | undefined> {
  const rows = await s.db
    .select()
    .from(calendarEvents)
    .where(and(s.own(calendarEvents), eq(calendarEvents.key, key)));
  return rows[0];
}

/** События с днём в `from…to` включительно (без конца — до бесконечности), по дню и id. Без дня (правила без даты) — отдельно. */
export async function listEventsBetween(
  s: ScopedDb,
  from: string,
  to: string | null,
  limit: number,
): Promise<EventRow[]> {
  return s.db
    .select()
    .from(calendarEvents)
    .where(
      and(
        s.own(calendarEvents),
        isNotNull(calendarEvents.day),
        gte(calendarEvents.day, from),
        to === null ? undefined : lte(calendarEvents.day, to),
      ),
    )
    .orderBy(asc(calendarEvents.day), asc(calendarEvents.id))
    .limit(limit);
}

/** События без дня (правила, чьё срок норма не привязывает к дате): человек укажет день сам. */
export async function listUndated(s: ScopedDb): Promise<EventRow[]> {
  return s.db
    .select()
    .from(calendarEvents)
    .where(and(s.own(calendarEvents), isNull(calendarEvents.day)))
    .orderBy(asc(calendarEvents.createdAt), asc(calendarEvents.id));
}

export async function patchEvent(
  s: ScopedDb,
  id: string,
  patch: Partial<
    Pick<EventRow, "day" | "remindDays" | "onEdited" | "amountMinor" | "title" | "params">
  >,
): Promise<void> {
  await s.update(calendarEvents, eq(calendarEvents.id, id)).set(patch);
}

export async function removeEvent(s: ScopedDb, id: string): Promise<void> {
  await s.delete(calendarEvents, eq(calendarEvents.id, id));
}

/** События пользователя с ключом по префиксу (`rule:` — пересчёт сроков налогов). */
export async function listByKeyPrefix(s: ScopedDb, prefix: string): Promise<EventRow[]> {
  return s.db
    .select()
    .from(calendarEvents)
    .where(and(s.own(calendarEvents), sql`${calendarEvents.key} like ${`${prefix}%`}`));
}

/**
 * Заменить напоминания события. Неотправленные прежние уходят, новые встают на их место; отправленные сохраняются
 * (тот же «за сколько дней» второй раз не шлём), если день не менялся — иначе (`all`) уходят все: новый день, новые напоминания.
 */
export async function replaceReminders(
  s: ScopedDb,
  eventId: string,
  plans: readonly { offsetDays: number; dueAt: Date }[],
  all = false,
): Promise<void> {
  await s.delete(
    calendarReminders,
    all
      ? eq(calendarReminders.eventId, eventId)
      : (and(eq(calendarReminders.eventId, eventId), eq(calendarReminders.status, "pending")) ??
          sql`true`),
  );
  if (plans.length === 0) return;
  await s
    .insert(calendarReminders)
    .values(
      plans.map((plan) => ({
        eventId,
        offsetDays: plan.offsetDays,
        dueAt: plan.dueAt,
      })),
    )
    .onConflictDoNothing({
      target: [
        calendarReminders.householdId,
        calendarReminders.eventId,
        calendarReminders.offsetDays,
      ],
    });
}

export async function remindersOf(s: ScopedDb, eventId: string): Promise<ReminderRow[]> {
  return s.db
    .select()
    .from(calendarReminders)
    .where(and(s.own(calendarReminders), eq(calendarReminders.eventId, eventId)))
    .orderBy(asc(calendarReminders.offsetDays));
}

export interface DueRow {
  readonly reminderId: string;
  readonly eventId: string;
  readonly offsetDays: number;
  readonly day: string | null;
  readonly type: string;
  readonly title: string | null;
  readonly rule: string | null;
}

/** Наступившие и неотправленные напоминания пользователя (срок ≤ `now`), с событием: на тик хватает одного запроса. */
export async function dueReminders(s: ScopedDb, now: Date): Promise<DueRow[]> {
  return s.db
    .select({
      reminderId: calendarReminders.id,
      eventId: calendarReminders.eventId,
      offsetDays: calendarReminders.offsetDays,
      day: calendarEvents.day,
      type: calendarEvents.type,
      title: calendarEvents.title,
      rule: calendarEvents.rule,
    })
    .from(calendarReminders)
    .innerJoin(
      calendarEvents,
      and(
        eq(calendarEvents.id, calendarReminders.eventId),
        eq(calendarEvents.householdId, calendarReminders.householdId),
        s.own(calendarEvents),
      ),
    )
    .where(
      and(
        s.own(calendarReminders),
        eq(calendarReminders.status, "pending"),
        lte(calendarReminders.dueAt, now),
      ),
    )
    .orderBy(asc(calendarReminders.dueAt), asc(calendarReminders.id));
}

export async function markReminders(
  s: ScopedDb,
  ids: readonly string[],
  status: "sent" | "skipped",
  at: Date,
): Promise<void> {
  if (ids.length === 0) return;
  await s
    .update(calendarReminders, inArray(calendarReminders.id, [...ids]))
    .set({ status, sentAt: status === "sent" ? at : null });
}

/**
 * Сквозной поиск для минутного тика (NFR-22): владельцы неотправленных напоминаний — по одной строке на пользователя
 * (`DISTINCT ON`). Срок сверяет задача по часам под scope владельца: часы теста и боевые — не часы базы.
 */
export const findReminderOwners: SweepFind = async (db) =>
  db
    .selectDistinctOn([calendarReminders.householdId, calendarReminders.userId], {
      id: calendarReminders.id,
      householdId: calendarReminders.householdId,
      userId: calendarReminders.userId,
    })
    .from(calendarReminders)
    .where(eq(calendarReminders.status, "pending"))
    .orderBy(calendarReminders.householdId, calendarReminders.userId, calendarReminders.id);
