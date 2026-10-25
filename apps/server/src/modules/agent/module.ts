// Модуль agent (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { LlmFacade } from "../llm/index.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { ProfileFacade } from "../profile/index.ts";
import type { LegalConsultFacade } from "../legal-consult/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface AgentFacades {
  readonly llm: LlmFacade;
  readonly actions: ActionsFacade;
  readonly profile: ProfileFacade;
  readonly legalConsult: LegalConsultFacade;
}

export function createAgentModule(_deps: ModuleDeps<AgentFacades, Platform>) {
  return defineModule({ id: "agent" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type AgentFacade = ReturnType<typeof createAgentModule>["facade"];
