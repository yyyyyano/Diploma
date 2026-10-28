// Публичный API модуля profile (паспорт — CLAUDE.md): фабрика для корня композиции, типы фасада и событие для соседей.
export { factsChanged } from "./events.ts";
export { createProfileModule, type ProfileFacade, type ProfileFacades } from "./module.ts";
