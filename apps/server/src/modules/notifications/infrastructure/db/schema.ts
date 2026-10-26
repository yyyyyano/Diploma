// Таблицы notifications (NOTIF-01…05, ARCHITECTURE §6.1). Уведомления пользователя и его настройки — userOwnedTable;
// уведомления администраторов (NOTIF-03) — systemTable без домохозяйства, «прочитано» — своя строка у каждого админа.
import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { systemTable, userOwnedTable } from "../../../../platform/db/tables.ts";

type Params = Record<string, string | number>;
type ObjectRef = { entity: string; id: string };

/**
 * Уведомление пользователя: вид, ключ идемпотентности (повтор того же события — та же строка), параметры текста,
 * объект, id ожидающего решения и токен отмены (кнопки «Да/Нет», «Отменить» — в actions); shown_on_web — доставлено в
 * ленту сайта (вид включён в канале web), read_at — прочитано.
 */
export const notifications = userOwnedTable(
  "notifications",
  {
    kind: text().notNull(),
    key: text().notNull(),
    params: jsonb().$type<Params>().notNull(),
    objectRef: jsonb().$type<ObjectRef>(),
    decisionId: uuid(),
    undoToken: uuid(),
    shownOnWeb: boolean().notNull().default(false),
    readAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex("notifications_key_idx").on(t.householdId, t.userId, t.kind, t.key)],
);

/** Отключённые виды по каналам (NOTIF-04): строки нет — вид включён. */
export const notificationPreferences = userOwnedTable(
  "notification_preferences",
  {
    kind: text().notNull(),
    channel: text().notNull(),
    enabled: boolean().notNull(),
  },
  (t) => [
    uniqueIndex("notification_preferences_idx").on(t.householdId, t.userId, t.kind, t.channel),
  ],
);

/** Уведомление администраторов (NOTIF-03): одно на событие (вид + ключ), без домохозяйства. */
export const adminNotifications = systemTable(
  "admin_notifications",
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    kind: text().notNull(),
    key: text().notNull(),
    params: jsonb().$type<Params>().notNull(),
    objectRef: jsonb().$type<ObjectRef>(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("admin_notifications_key_idx").on(t.kind, t.key)],
);

/** «Прочитано» администратором: у каждого своё. */
export const adminNotificationReads = systemTable(
  "admin_notification_reads",
  {
    notificationId: uuid()
      .notNull()
      .references(() => adminNotifications.id, { onDelete: "cascade" }),
    userId: uuid().notNull(),
    readAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.userId] })],
);
