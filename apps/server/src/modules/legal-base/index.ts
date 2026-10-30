// Публичный API модуля legal-base (паспорт — CLAUDE.md): фабрика для корня композиции и типы для соседей.
export { createLegalBaseModule, type LegalBaseFacade, type LegalBaseFacades } from "./module.ts";
export { actRepealed, actUpdated } from "./events.ts";
