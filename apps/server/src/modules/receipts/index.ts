// Публичный API модуля receipts (паспорт — CLAUDE.md): фабрика для корня композиции и типы для соседей.
export { createReceiptsModule, type ReceiptsFacade, type ReceiptsFacades } from "./module.ts";
export type { WarrantyItem } from "./domain/warranty.ts";
export { receiptsWarrantyItemsFound } from "./events.ts";
