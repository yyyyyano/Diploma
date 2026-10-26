// Модуль actions (паспорт — CLAUDE.md): журнал отменяемых действий и ожидающие решения «Да/Нет» — таблицы и владелец
// данных; сценарии и процедуры — следующим шагом.
import {
  defineModule,
  type ModuleDeps,
  type NoFacades,
  type Platform,
} from "../../platform/module/define-module.ts";
import { actionsUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export type ActionsFacades = NoFacades;

export function createActionsModule(_deps: ModuleDeps<ActionsFacades, Platform>) {
  return defineModule({ id: "actions", userData: actionsUserData });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type ActionsFacade = ReturnType<typeof createActionsModule>["facade"];
