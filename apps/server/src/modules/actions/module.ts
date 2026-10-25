// Модуль actions (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type NoFacades,
  type Platform,
} from "../../platform/module/define-module.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export type ActionsFacades = NoFacades;

export function createActionsModule(_deps: ModuleDeps<ActionsFacades, Platform>) {
  return defineModule({ id: "actions" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type ActionsFacade = ReturnType<typeof createActionsModule>["facade"];
