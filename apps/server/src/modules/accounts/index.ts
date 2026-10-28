// Публичный API модуля accounts (паспорт — CLAUDE.md): фабрика для корня композиции, типы фасада и событие для соседей.
export { balancesChanged } from "./events.ts";
export { createAccountsModule, type AccountsFacade, type AccountsFacades } from "./module.ts";
