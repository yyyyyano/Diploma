// Уведомления (NOTIF-01…05): лента с курсором, счётчик непрочитанных, «прочитано», настройки вида × канала, лента
// администратора. Текст — на сайте из словаря по виду и параметрам; кнопки «Да/Нет» сайт шлёт прямо в actions по
// decisionId, «Отменить» — по undoToken, «Показать» — ссылка на объект (objectRef).
import { oc } from "@orpc/contract";
import { z } from "zod";
import { DecisionId, UndoToken } from "../actions/actions.contract.ts";
import { EntityId, EntityKind } from "../common.ts";
import { pickErrors } from "../errors.ts";

/**
 * NOTIF-02: виды уведомлений пользователя — весь каталог, источники появляются своими задачами; data-export-ready —
 * архив «Мои данные» готов (PRIV-05).
 */
export const USER_NOTIFICATION_KINDS = [
  "limit",
  "goal",
  "deduction",
  "receipt-match",
  "receipt-review",
  "statement-imported",
  "calendar-reminder",
  "weekly-summary",
  "recurring-missed",
  "data-export-ready",
] as const;
export const UserNotificationKind = z.enum(USER_NOTIFICATION_KINDS);
export type UserNotificationKind = z.infer<typeof UserNotificationKind>;

/** NOTIF-03: виды уведомлений администратора. */
export const ADMIN_NOTIFICATION_KINDS = [
  "law-update-failed",
  "law-new-acts",
  "law-layout-changed",
  "rates-mismatch",
  "ai-provider",
] as const;
export const AdminNotificationKind = z.enum(ADMIN_NOTIFICATION_KINDS);
export type AdminNotificationKind = z.infer<typeof AdminNotificationKind>;

/** Каналы доставки (NOTIF-04): сайт и Telegram (T-053). */
export const NotificationChannel = z.enum(["web", "telegram"]);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

/** Параметры текста: значения для подстановки (сумма — строкой готового формата сервера нет: только числа и id). */
export const NotificationParams = z.record(
  z.string().max(64),
  z.union([z.string().max(200), z.number()]),
);

/** Объект уведомления — куда ведёт «Показать». */
export const ObjectRef = z.strictObject({ entity: EntityKind, id: EntityId });

const NotificationBase = {
  id: z.uuid(),
  params: NotificationParams,
  objectRef: ObjectRef.nullable(),
  read: z.boolean(),
  createdAt: z.iso.datetime(),
};

export const UserNotification = z.strictObject({
  ...NotificationBase,
  kind: UserNotificationKind,
  decisionId: DecisionId.nullable(),
  undoToken: UndoToken.nullable(),
});
export type UserNotification = z.infer<typeof UserNotification>;

export const AdminNotification = z.strictObject({
  ...NotificationBase,
  kind: AdminNotificationKind,
});
export type AdminNotification = z.infer<typeof AdminNotification>;

/**
 * Страница ленты: новые сверху; курсор — id последнего показанного (uuidv7 — по времени). GET: вход приходит строкой
 * запроса — размер страницы приводится к числу (coerce), иначе «20» не прошло бы схему.
 */
export const FeedInput = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const Ok = z.strictObject({ ok: z.literal(true) });
const ReadInput = z.strictObject({ ids: z.array(z.uuid()).min(1).max(100) });

export const Preference = z.strictObject({
  kind: UserNotificationKind,
  web: z.boolean(),
  telegram: z.boolean(),
});

export const notificationsContract = {
  /** Лента пользователя с курсором и счётчик непрочитанных. */
  list: oc
    .route({ method: "GET", path: "/notifications" })
    .input(FeedInput)
    .output(
      z.strictObject({
        items: z.array(UserNotification),
        nextCursor: z.uuid().nullable(),
        unread: z.int().min(0),
      }),
    )
    .errors(pickErrors("UNAUTHORIZED")),
  /** Отметить прочитанными; чужие id не меняются. */
  markRead: oc
    .route({ method: "POST", path: "/notifications/read" })
    .input(ReadInput)
    .output(Ok)
    .errors(pickErrors("UNAUTHORIZED")),
  /** «Прочитать все». */
  markAllRead: oc
    .route({ method: "POST", path: "/notifications/read-all" })
    .output(Ok)
    .errors(pickErrors("UNAUTHORIZED")),
  /** Настройки: вид × канал (по умолчанию всё включено). */
  preferences: oc
    .route({ method: "GET", path: "/notifications/preferences" })
    .output(z.strictObject({ items: z.array(Preference) }))
    .errors(pickErrors("UNAUTHORIZED")),
  setPreference: oc
    .route({ method: "POST", path: "/notifications/preferences" })
    .input(
      z.strictObject({
        kind: UserNotificationKind,
        channel: NotificationChannel,
        enabled: z.boolean(),
      }),
    )
    .output(Ok)
    .errors(pickErrors("UNAUTHORIZED")),
  /** Лента администратора (NOTIF-03): только роль admin; «прочитано» — у каждого админа своё. */
  adminList: oc
    .route({ method: "GET", path: "/notifications/admin" })
    .input(FeedInput)
    .output(
      z.strictObject({
        items: z.array(AdminNotification),
        nextCursor: z.uuid().nullable(),
        unread: z.int().min(0),
      }),
    )
    .errors(pickErrors("UNAUTHORIZED", "FORBIDDEN")),
  adminMarkRead: oc
    .route({ method: "POST", path: "/notifications/admin/read" })
    .input(ReadInput)
    .output(Ok)
    .errors(pickErrors("UNAUTHORIZED", "FORBIDDEN")),
};
