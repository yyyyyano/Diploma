// Запросы к журналу действий и ожидающим решениям: первый аргумент — s: ScopedDb, у каждого обращения свой s.own.
// Строки, которые меняет ответ человека, читаются FOR UPDATE: двойное нажатие «Отменить» или «Да» ждёт первое и
// видит уже изменённое состояние — действие не выполняется дважды.
import { and, asc, desc, eq, gt, gte, ne, or } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { actionJournal, pendingDecisions } from "./schema.ts";

export type ActionChannel = "web" | "telegram";
export type DecisionStatus = "pending" | "yes" | "no";
export interface DecisionSummary {
  readonly key: string;
  readonly params: Record<string, string | number>;
}

export interface ActionRow {
  readonly id: string;
  readonly handler: string;
  readonly payload: unknown;
  readonly subject: string;
  readonly status: "done" | "undone";
  readonly createdAt: Date;
}

export async function insertAction(
  s: ScopedDb,
  action: {
    readonly handler: string;
    readonly payload: unknown;
    readonly subject: string;
    readonly channel: ActionChannel;
  },
  at: Date,
): Promise<string> {
  const rows = await s
    .insert(actionJournal)
    .values({ ...action, createdAt: at, updatedAt: at })
    .returning({ id: actionJournal.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("action_journal: вставка не вернула id.");
  return id;
}

/** Действие по токену под блокировкой строки; чужое и неизвестное — undefined. */
export async function lockAction(s: ScopedDb, id: string): Promise<ActionRow | undefined> {
  const rows = await s.db
    .select({
      id: actionJournal.id,
      handler: actionJournal.handler,
      payload: actionJournal.payload,
      subject: actionJournal.subject,
      status: actionJournal.status,
      createdAt: actionJournal.createdAt,
    })
    .from(actionJournal)
    .where(and(s.own(actionJournal), eq(actionJournal.id, id)))
    .for("update");
  const row = rows[0];
  if (row === undefined) return undefined;
  return { ...row, status: row.status === "undone" ? "undone" : "done" };
}

/**
 * Последнее не отменённое действие канала не старше `since` (TG-07 `/undo`: действие, сделанное через бот за 24 часа); токен — id
 * строки журнала. Только свои строки: `s.own` и пользователь scope.
 */
export async function lastUndoableAction(
  s: ScopedDb,
  channel: ActionChannel,
  since: Date,
): Promise<string | undefined> {
  const rows = await s.db
    .select({ id: actionJournal.id })
    .from(actionJournal)
    .where(
      and(
        s.own(actionJournal),
        eq(actionJournal.userId, s.scope.userId),
        eq(actionJournal.channel, channel),
        eq(actionJournal.status, "done"),
        gte(actionJournal.createdAt, since),
      ),
    )
    .orderBy(desc(actionJournal.createdAt), desc(actionJournal.id))
    .limit(1);
  return rows[0]?.id;
}

/** Есть ли после этого действия другое, не отменённое, над тем же объектом (P5: отмена не затирает правку). */
export async function hasLaterAction(s: ScopedDb, action: ActionRow): Promise<boolean> {
  const rows = await s.db
    .select({ id: actionJournal.id })
    .from(actionJournal)
    .where(
      and(
        s.own(actionJournal),
        eq(actionJournal.subject, action.subject),
        eq(actionJournal.status, "done"),
        ne(actionJournal.id, action.id),
        or(
          gt(actionJournal.createdAt, action.createdAt),
          and(eq(actionJournal.createdAt, action.createdAt), gt(actionJournal.id, action.id)),
        ),
      ),
    )
    .orderBy(asc(actionJournal.createdAt))
    .limit(1);
  return rows.length > 0;
}

export async function markUndone(s: ScopedDb, id: string, at: Date): Promise<void> {
  await s
    .update(actionJournal, eq(actionJournal.id, id))
    .set({ status: "undone", undoneAt: at, updatedAt: at });
}

export interface DecisionRow {
  readonly id: string;
  readonly handler: string;
  readonly payload: unknown;
  readonly summary: DecisionSummary;
  readonly status: DecisionStatus;
  readonly createdAt: Date;
}

export async function insertDecision(
  s: ScopedDb,
  decision: {
    readonly handler: string;
    readonly payload: unknown;
    readonly summary: DecisionSummary;
  },
  at: Date,
): Promise<string> {
  const rows = await s
    .insert(pendingDecisions)
    .values({ ...decision, createdAt: at, updatedAt: at })
    .returning({ id: pendingDecisions.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("pending_decisions: вставка не вернула id.");
  return id;
}

function toDecision(row: {
  id: string;
  handler: string;
  payload: unknown;
  summary: DecisionSummary;
  status: string;
  createdAt: Date;
}): DecisionRow {
  const status: DecisionStatus =
    row.status === "yes" || row.status === "no" ? row.status : "pending";
  return { ...row, status };
}

const decisionColumns = {
  id: pendingDecisions.id,
  handler: pendingDecisions.handler,
  payload: pendingDecisions.payload,
  summary: pendingDecisions.summary,
  status: pendingDecisions.status,
  createdAt: pendingDecisions.createdAt,
};

/** Решение по id; чужое и неизвестное — undefined. lock — под блокировкой строки (ответ). */
export async function findDecision(
  s: ScopedDb,
  id: string,
  lock = false,
): Promise<DecisionRow | undefined> {
  const query = s.db
    .select(decisionColumns)
    .from(pendingDecisions)
    .where(and(s.own(pendingDecisions), eq(pendingDecisions.id, id)));
  const rows = lock ? await query.for("update") : await query;
  const row = rows[0];
  return row === undefined ? undefined : toDecision(row);
}

export async function answerDecision(
  s: ScopedDb,
  id: string,
  answer: { readonly status: "yes" | "no"; readonly channel: ActionChannel },
  at: Date,
): Promise<void> {
  await s
    .update(pendingDecisions, eq(pendingDecisions.id, id))
    .set({ status: answer.status, channel: answer.channel, answeredAt: at, updatedAt: at });
}
