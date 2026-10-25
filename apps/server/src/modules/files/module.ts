// Модуль files (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type NoFacades,
  type Platform,
} from "../../platform/module/define-module.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export type FilesFacades = NoFacades;

export function createFilesModule(_deps: ModuleDeps<FilesFacades, Platform>) {
  return defineModule({ id: "files" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type FilesFacade = ReturnType<typeof createFilesModule>["facade"];
