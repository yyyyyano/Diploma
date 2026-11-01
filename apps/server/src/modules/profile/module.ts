// Модуль profile (паспорт — CLAUDE.md): факты о пользователе для законов РБ (PROF-01…06), «Что ассистент знает обо
// мне», анкета после первого входа (AUTH-07); «Отменить» у фактов — через actions.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { IdentityFacade } from "../identity/index.ts";
import { profileTools } from "./agent/tools.ts";
import { profileRouter } from "./api/router.ts";
import { makeFacts, RESTORE_HANDLER } from "./application/facts.ts";
import { makeKnownNames } from "./application/known-names.ts";
import { factsChanged } from "./events.ts";
import { profileUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface ProfileFacades {
  readonly identity: IdentityFacade;
  readonly actions: ActionsFacade;
}

export function createProfileModule({ platform, facades }: ModuleDeps<ProfileFacades, Platform>) {
  const facts = makeFacts({ platform, actions: facades.actions });
  const tools = profileTools(facts, platform.clock);
  return defineModule({
    id: "profile",
    facade: {
      getFacts: facts.getFacts,
      upsertDerivedFact: facts.upsertDerivedFact,
      recordAnswer: facts.recordAnswer,
      // Ответ человека на вопрос системы вне чата (T-048: «У вас есть автомобиль?» в календаре): факт «подтверждён», с «Отменить».
      setFact: facts.set,
    },
    router: profileRouter(facts),
    events: [factsChanged],
    tools: [tools.readFacts, tools.upsertFact],
    undo: { [RESTORE_HANDLER]: facts.restore },
    userData: profileUserData,
    // PRIV-03: имена детей — в словарь маскирования шлюза llm (облако получает метки вместо имён).
    knownNamesSource: makeKnownNames(platform),
  });
}

/** Что модуль даёт соседям: факты на дату вопроса, выводы системы, ответы на дозапрос. */
export type ProfileFacade = ReturnType<typeof createProfileModule>["facade"];
