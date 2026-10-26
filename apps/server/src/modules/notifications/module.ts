// Модуль notifications (паспорт — CLAUDE.md): уведомления пользователя и администраторов — таблицы и владелец данных;
// сценарии и процедуры — следующим шагом.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { IdentityFacade } from "../identity/index.ts";
import { notificationsUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface NotificationsFacades {
  readonly identity: IdentityFacade;
}

export function createNotificationsModule(_deps: ModuleDeps<NotificationsFacades, SystemPlatform>) {
  return defineModule({ id: "notifications", userData: notificationsUserData });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type NotificationsFacade = ReturnType<typeof createNotificationsModule>["facade"];
