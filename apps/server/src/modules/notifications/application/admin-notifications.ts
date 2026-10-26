// Уведомления администраторов (NOTIF-03): фасад notifyAdmins без ScopedDb — событие системы, а не домохозяйства
// (ошибки обновления законов, новые акты, расхождение ставок, сбои провайдеров ИИ). Идемпотентно по виду и ключу.
// Видит их только роль admin (процедура admin), «прочитано» — у каждого администратора своё.
import type { AdminNotification, AdminNotificationKind } from "@kosht/contract";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import {
  adminFeedPage,
  countAdminUnread,
  insertAdminNotification,
  markAdminRead,
} from "../infrastructure/db/admin-notifications.repo.ts";

export function makeAdminNotifications(d: Pick<SystemPlatform, "system" | "clock" | "log">) {
  async function notifyAdmins(input: {
    readonly kind: AdminNotificationKind;
    readonly key: string;
    readonly objectRef?: { readonly entity: string; readonly id: string };
    readonly params?: Record<string, string | number>;
  }): Promise<string | undefined> {
    const id = await insertAdminNotification(
      d.system,
      { kind: input.kind, key: input.key, params: input.params ?? {}, objectRef: input.objectRef },
      d.clock.now(),
    );
    if (id !== undefined)
      d.log.info({ notificationId: id, reason: input.kind }, "notifications.admin-created");
    return id;
  }

  /** Лента администратора: s — сессия админа (его id — для отметок «прочитано»). */
  async function list(s: ScopedDb, input: { cursor?: string | undefined; limit: number }) {
    const rows = await adminFeedPage(d.system, s.scope.userId, input.cursor, input.limit);
    const page = rows.slice(0, input.limit);
    const items: AdminNotification[] = page.map((row) => ({
      id: row.id,
      kind: row.kind as AdminNotification["kind"],
      params: row.params,
      objectRef: row.objectRef,
      read: row.readAt !== null,
      createdAt: row.createdAt.toISOString(),
    }));
    return {
      items,
      nextCursor: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
      unread: await countAdminUnread(d.system, s.scope.userId),
    };
  }

  async function read(s: ScopedDb, ids: readonly string[]): Promise<void> {
    await markAdminRead(d.system, s.scope.userId, ids, d.clock.now());
  }

  return { notifyAdmins, list, read };
}
