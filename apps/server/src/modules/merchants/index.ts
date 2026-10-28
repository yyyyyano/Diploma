// Публичный API модуля merchants (паспорт — CLAUDE.md): фабрика для корня композиции и типы для соседей.
export type { MerchantInfo } from "./application/resolve.ts";
export { createMerchantsModule, type MerchantsFacade, type MerchantsFacades } from "./module.ts";
