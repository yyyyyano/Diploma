// Публичный API модуля recurring (паспорт — CLAUDE.md): фабрика для корня композиции, событие и типы для соседей.
export { recurringChanged } from "./events.ts";
export { createRecurringModule, type RecurringFacade, type RecurringFacades } from "./module.ts";
export type { UpcomingPayment } from "./application/read.ts";
export type { RecurringEntry } from "./application/view.ts";
