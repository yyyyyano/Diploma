// Процедуры notifications (contract.notifications.*): лента, «прочитано» и настройки — authed (своё); лента
// администратора — admin (роль проверяет платформа, FORBIDDEN).
import { admin, authed } from "../../../platform/http/procedures.ts";
import type { makeAdminNotifications } from "../application/admin-notifications.ts";
import type { makeFeed } from "../application/feed.ts";

export interface NotificationsUseCases {
  readonly feed: ReturnType<typeof makeFeed>;
  readonly admin: ReturnType<typeof makeAdminNotifications>;
}

const ok = { ok: true as const };

export function notificationsRouter(uc: NotificationsUseCases) {
  return {
    list: authed.notifications.list.handler(({ input, context }) => uc.feed.list(context.s, input)),
    markRead: authed.notifications.markRead.handler(async ({ input, context }) => {
      await uc.feed.read(context.s, input.ids);
      return ok;
    }),
    markAllRead: authed.notifications.markAllRead.handler(async ({ context }) => {
      await uc.feed.read(context.s, "all");
      return ok;
    }),
    preferences: authed.notifications.preferences.handler(({ context }) =>
      uc.feed.preferences(context.s),
    ),
    setPreference: authed.notifications.setPreference.handler(async ({ input, context }) => {
      await uc.feed.setPreference(context.s, input);
      return ok;
    }),
    adminList: admin.notifications.adminList.handler(({ input, context }) =>
      uc.admin.list(context.s, input),
    ),
    adminMarkRead: admin.notifications.adminMarkRead.handler(async ({ input, context }) => {
      await uc.admin.read(context.s, input.ids);
      return ok;
    }),
  };
}
