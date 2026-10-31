// Публичный API модуля norm-tables (паспорт — CLAUDE.md): фабрика для корня композиции и типы для соседей.
export { createNormTablesModule, type NormTablesFacade, type NormTablesFacades } from "./module.ts";
export { valuesConfirmed } from "./events.ts";
export type { RateAnswer } from "./application/rates.ts";
