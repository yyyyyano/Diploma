// Модуль explain (паспорт — CLAUDE.md): сохранённые трассы расчётов и «Откуда эта цифра?» (EXPL-01, EXPL-02, P2):
// фасад save/get для модулей, процедура explain.get для сайта, инструменты explain_number и calculator для агента.
import {
  defineModule,
  type ModuleDeps,
  type NoFacades,
  type Platform,
} from "../../platform/module/define-module.ts";
import { calculatorTool } from "./agent/calculator.ts";
import { explainNumberTool } from "./agent/tools.ts";
import { MAX_REFS } from "./settings.ts";
import { explainRouter } from "./api/router.ts";
import { makeExplanations } from "./application/explanations.ts";
import { explainUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export type ExplainFacades = NoFacades;

export function createExplainModule({ platform }: ModuleDeps<ExplainFacades, Platform>) {
  const explanations = makeExplanations(platform);
  return defineModule({
    id: "explain",
    facade: explanations,
    router: explainRouter(explanations),
    tools: [explainNumberTool(explanations), calculatorTool(explanations)],
    settings: [MAX_REFS],
    userData: explainUserData,
  });
}

/** Что модуль даёт соседям: save(s, calc, { period }) → traceId; get(s, traceId) — сохранённый расчёт. */
export type ExplainFacade = ReturnType<typeof createExplainModule>["facade"];
