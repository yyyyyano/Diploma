// Модуль quality (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { LlmFacade } from "../llm/index.ts";
import type { ReceiptsFacade } from "../receipts/index.ts";
import type { StatementsFacade } from "../statements/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { LegalBaseFacade } from "../legal-base/index.ts";
import type { LegalConsultFacade } from "../legal-consult/index.ts";
import type { AgentFacade } from "../agent/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface QualityFacades {
  readonly llm: LlmFacade;
  readonly receipts: ReceiptsFacade;
  readonly statements: StatementsFacade;
  readonly categories: CategoriesFacade;
  readonly legalBase: LegalBaseFacade;
  readonly legalConsult: LegalConsultFacade;
  readonly agent: AgentFacade;
}

export function createQualityModule(_deps: ModuleDeps<QualityFacades, SystemPlatform>) {
  return defineModule({ id: "quality" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type QualityFacade = ReturnType<typeof createQualityModule>["facade"];
