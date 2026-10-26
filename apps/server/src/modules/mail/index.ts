// Публичный API модуля mail (паспорт — CLAUDE.md): фабрика для корня композиции и типы для соседей.
export type { MailTemplate } from "./application/compose-message.ts";
export { createMailModule, type MailFacade, type MailFacades } from "./module.ts";
