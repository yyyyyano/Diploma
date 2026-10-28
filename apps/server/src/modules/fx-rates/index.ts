// Публичный API модуля fx-rates (паспорт — CLAUDE.md): фабрика для корня композиции и типы для соседей.
export type { FxRatesSource } from "./application/ports.ts";
export type { FxRate } from "./domain/fx-rate.ts";
export { createFxRatesModule, type FxRatesFacade, type FxRatesFacades } from "./module.ts";
