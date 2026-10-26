// Публичный API модуля notifications (паспорт — CLAUDE.md): фабрика для корня композиции и типы для соседей.
export type { NotifyInput } from "./application/notify.ts";
export {
  createNotificationsModule,
  type NotificationsFacade,
  type NotificationsFacades,
} from "./module.ts";
