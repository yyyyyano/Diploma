// Публичный API модуля identity (паспорт — CLAUDE.md): фабрика для корня композиции, типы и события для соседей.
export { systemInitialized, userRegistered } from "./events.ts";
export { createIdentityModule, type IdentityFacade, type IdentityFacades } from "./module.ts";
