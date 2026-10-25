// Модуль agent (паспорт — CLAUDE.md): цикл агента на AI SDK 7 с моделью из шлюза llm и инструментами модулей из
// реестра корня композиции; предметные модули агент не импортирует (ADR-0009).
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { LlmFacade } from "../llm/index.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { ProfileFacade } from "../profile/index.ts";
import type { LegalConsultFacade } from "../legal-consult/index.ts";
import { makeRunAgent } from "./application/run-agent.ts";
import { MAX_STEPS } from "./settings.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface AgentFacades {
  readonly llm: LlmFacade;
  readonly actions: ActionsFacade;
  readonly profile: ProfileFacade;
  readonly legalConsult: LegalConsultFacade;
}

export function createAgentModule({ platform, facades }: ModuleDeps<AgentFacades, Platform>) {
  const run = makeRunAgent({
    llm: facades.llm,
    tools: () => platform.tools(),
    scoped: (scope) => platform.scoped(scope),
    log: platform.log,
    maxSteps: () => platform.settings.get(MAX_STEPS),
  });
  return defineModule({ id: "agent", facade: { run }, settings: [MAX_STEPS] });
}

/** Что модуль даёт соседям: запуск агента с потоком UI-сообщения. */
export type AgentFacade = ReturnType<typeof createAgentModule>["facade"];
