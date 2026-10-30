// Публичный API модуля fin (паспорт — CLAUDE.md): фабрика для корня композиции и типы для соседей.
export { createFinModule, type FinFacade, type FinFacades } from "./module.ts";
export type { FreeBalanceCalc } from "./application/free-balance.ts";
export type { Forecast } from "./application/forecast.ts";
