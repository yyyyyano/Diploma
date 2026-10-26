// Публичный API модуля files (паспорт — CLAUDE.md): фабрика для корня композиции и типы для соседей.
export type { NewFile, OpenedFile } from "./application/files.ts";
export { createFilesModule, type FilesFacade, type FilesFacades } from "./module.ts";
