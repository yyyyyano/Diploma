// Модуль explain (паспорт — CLAUDE.md): сохранённые трассы расчётов (EXPL-01, EXPL-02, P2) — таблица и владелец данных.
import {
  defineModule,
  type ModuleDeps,
  type NoFacades,
  type Platform,
} from "../../platform/module/define-module.ts";
import { explainUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export type ExplainFacades = NoFacades;

export function createExplainModule(_deps: ModuleDeps<ExplainFacades, Platform>) {
  return defineModule({ id: "explain", userData: explainUserData });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type ExplainFacade = ReturnType<typeof createExplainModule>["facade"];
