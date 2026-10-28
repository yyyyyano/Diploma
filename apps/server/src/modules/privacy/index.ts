// Публичный API модуля privacy (паспорт — CLAUDE.md): фабрика для корня композиции, типы и события для соседей.
export { consentChanged, exportReady } from "./events.ts";
export { createPrivacyModule, type PrivacyFacade, type PrivacyFacades } from "./module.ts";
