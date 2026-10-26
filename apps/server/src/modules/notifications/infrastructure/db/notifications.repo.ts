// Уведомления и настройки пользователя: первый аргумент — s: ScopedDb, у каждого обращения свой s.own. Лента — только
// доставленные на сайт (shown_on_web), новые сверху по id (uuidv7 растёт со временем) — курсор = id последнего.
import { and, count, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { notificationPreferences, notifications } from "./schema.ts";

export interface NewNotification {
  readonly kind: string;
  readonly key: string;
  readonly params: Record<string, string | number>;
  readonly objectRef: { entity: string; id: string } | undefined;
  readonly decisionId: string | undefined;
  readonly undoToken: string | undefined;
}

/** Новое уведомление; такое (вид + ключ) уже есть — undefined (идемпотентность «хотя бы раз»). */
export async function insertNotification(
  s: ScopedDb,
  n: NewNotification,
  at: Date,
): Promise<string | undefined> {
  const rows = await s
    .insert(notifications)
    .values({
      kind: n.kind,
      key: n.key,
      params: n.params,
      objectRef: n.objectRef ?? null,
      decisionId: n.decisionId ?? null,
      undoToken: n.undoToken ?? null,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing({
      target: [
        notifications.householdId,
        notifications.userId,
        notifications.kind,
        notifications.key,
      ],
    })
    .returning({ id: notifications.id });
  return rows[0]?.id;
}

export async function markShownOnWeb(s: ScopedDb, ids: readonly string[]): Promise<void> {
  await s.update(notifications, inArray(notifications.id, [...ids])).set({ shownOnWeb: true });
}

export interface FeedRow {
  readonly id: string;
  readonly kind: string;
  readonly params: Record<string, string | number>;
  readonly objectRef: { entity: string; id: string } | null;
  readonly decisionId: string | null;
  readonly undoToken: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

/** Страница ленты пользователя scope: limit + 1 строка — есть ли следующая. */
export async function feedPage(
  s: ScopedDb,
  cursor: string | undefined,
  limit: number,
): Promise<FeedRow[]> {
  return s.db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      params: notifications.params,
      objectRef: notifications.objectRef,
      decisionId: notifications.decisionId,
      undoToken: notifications.undoToken,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        s.own(notifications),
        eq(notifications.userId, s.scope.userId),
        eq(notifications.shownOnWeb, true),
        cursor === undefined ? undefined : lt(notifications.id, cursor),
      ),
    )
    .orderBy(desc(notifications.id))
    .limit(limit + 1);
}

export async function countUnread(s: ScopedDb): Promise<number> {
  const rows = await s.db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        s.own(notifications),
        eq(notifications.userId, s.scope.userId),
        eq(notifications.shownOnWeb, true),
        isNull(notifications.readAt),
      ),
    );
  return rows[0]?.n ?? 0;
}

/** Отметить прочитанными (только свои; ids — или все непрочитанные). */
export async function markRead(
  s: ScopedDb,
  ids: readonly string[] | "all",
  at: Date,
): Promise<void> {
  const mine = and(eq(notifications.userId, s.scope.userId), isNull(notifications.readAt));
  const where = ids === "all" ? mine : and(mine, inArray(notifications.id, [...ids]));
  // and() из непустых условий всегда даёт условие; undefined — только у пустого списка.
  if (where === undefined) throw new Error("notifications: пустое условие отметки «прочитано».");
  await s.update(notifications, where).set({ readAt: at, updatedAt: at });
}

/** Отключённые пользователем пары «вид — канал». */
export async function disabledPairs(s: ScopedDb): Promise<{ kind: string; channel: string }[]> {
  return s.db
    .select({ kind: notificationPreferences.kind, channel: notificationPreferences.channel })
    .from(notificationPreferences)
    .where(
      and(
        s.own(notificationPreferences),
        eq(notificationPreferences.userId, s.scope.userId),
        eq(notificationPreferences.enabled, false),
      ),
    );
}

export async function savePreference(
  s: ScopedDb,
  pref: { readonly kind: string; readonly channel: string; readonly enabled: boolean },
  at: Date,
): Promise<void> {
  await s
    .insert(notificationPreferences)
    .values({ ...pref, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.householdId,
        notificationPreferences.userId,
        notificationPreferences.kind,
        notificationPreferences.channel,
      ],
      set: { enabled: pref.enabled, updatedAt: at },
    });
}
