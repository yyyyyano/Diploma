// Публичный API модуля transactions (паспорт — CLAUDE.md): фабрика для корня композиции, события и типы для соседей.
export { transactionsChanged, transactionsMerged } from "./events.ts";
export {
  createTransactionsModule,
  type TransactionsFacade,
  type TransactionsFacades,
} from "./module.ts";
