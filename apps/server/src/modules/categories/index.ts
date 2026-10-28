// Публичный API модуля categories (паспорт — CLAUDE.md): фабрика для корня композиции и типы для соседей.
export type { Categorized, CategorizeInput } from "./application/categorize.ts";
export { createCategoriesModule, type CategoriesFacade, type CategoriesFacades } from "./module.ts";
