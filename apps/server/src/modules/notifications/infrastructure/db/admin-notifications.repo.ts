// Уведомления администраторов (NOTIF-03): systemTable без домохозяйства — только SystemDb модуля notifications.
// «Прочитано» — строка (уведомление, администратор): у каждого своё.
import { and, count, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import { adminNotificationReads, adminNotifications } from "./schema.ts";

export async function insertAdminNotification(
  db: SystemDb,
  n: {
    readonly kind: string;
    readonly key: string;
    readonly params: Record<string, string | number>;
    readonly objectRef: { entity: string; id: string } | undefined;
  },
  at: Date,
): Promise<string | undefined> {
  const rows = await db
    .insert(adminNotifications)
    .values({ ...n, objectRef: n.objectRef ?? null, createdAt: at })
    .onConflictDoNothing({ target: [adminNotifications.kind, adminNotifications.key] })
    .returning({ id: adminNotifications.id });
  return rows[0]?.id;
}

/** Страница ленты администратора userId с его отметками «прочитано». */
export async function adminFeedPage(
  db: SystemDb,
  userId: string,
  cursor: string | undefined,
  limit: number,
) {
  return db
    .select({
      id: adminNotifications.id,
      kind: adminNotifications.kind,
      params: adminNotifications.params,
      objectRef: adminNotifications.objectRef,
      createdAt: adminNotifications.createdAt,
      readAt: adminNotificationReads.readAt,
    })
    .from(adminNotifications)
    .leftJoin(
      adminNotificationReads,
      and(
        eq(adminNotificationReads.notificationId, adminNotifications.id),
        eq(adminNotificationReads.userId, userId),
      ),
    )
    .where(cursor === undefined ? undefined : lt(adminNotifications.id, cursor))
    .orderBy(desc(adminNotifications.id))
    .limit(limit + 1);
}

export async function countAdminUnread(db: SystemDb, userId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(adminNotifications)
    .leftJoin(
      adminNotificationReads,
      and(
        eq(adminNotificationReads.notificationId, adminNotifications.id),
        eq(adminNotificationReads.userId, userId),
      ),
    )
    .where(isNull(adminNotificationReads.readAt));
  return rows[0]?.n ?? 0;
}

export async function markAdminRead(
  db: SystemDb,
  userId: string,
  ids: readonly string[],
  at: Date,
): Promise<void> {
  const known = await db
    .select({ id: adminNotifications.id })
    .from(adminNotifications)
    .where(inArray(adminNotifications.id, [...ids]));
  if (known.length === 0) return;
  await db
    .insert(adminNotificationReads)
    .values(known.map((row) => ({ notificationId: row.id, userId, readAt: at })))
    .onConflictDoNothing();
}

/** Удалить отметки «прочитано» администратора (удаление его аккаунта, PRIV-06). */
export async function deleteAdminReads(db: SystemDb, userId: string): Promise<void> {
  await db.delete(adminNotificationReads).where(eq(adminNotificationReads.userId, userId));
}
