// Модуль notifications (паспорт — CLAUDE.md): уведомления пользователя (центр с колокольчиком, идемпотентность по
// ключу, доставка по каналам реестра с учётом настроек — NOTIF-01…05) и уведомления администраторов (NOTIF-03).
// Канал web — свой; telegram подставит T-053 через deliveryChannels.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { IdentityFacade } from "../identity/index.ts";
import { makeAdminNotifications } from "./application/admin-notifications.ts";
import { makeNotify } from "./application/notify.ts";
import { webChannel } from "./application/web-channel.ts";
import { notificationsUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface NotificationsFacades {
  readonly identity: IdentityFacade;
}

export function createNotificationsModule({
  platform,
}: ModuleDeps<NotificationsFacades, SystemPlatform>) {
  const admins = makeAdminNotifications(platform);
  return defineModule({
    id: "notifications",
    facade: { notify: makeNotify(platform), notifyAdmins: admins.notifyAdmins },
    deliveryChannels: [webChannel(platform)],
    userData: notificationsUserData,
  });
}

/** Что модуль даёт соседям: notify(s, { kind, key, … }) и notifyAdmins({ kind, key, … }). */
export type NotificationsFacade = ReturnType<typeof createNotificationsModule>["facade"];
