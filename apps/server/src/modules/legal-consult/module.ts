// Модуль legal-consult (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { LegalBaseFacade } from "../legal-base/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface LegalConsultFacades {
  readonly legalBase: LegalBaseFacade;
}

export function createLegalConsultModule(_deps: ModuleDeps<LegalConsultFacades, Platform>) {
  return defineModule({ id: "legal-consult" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type LegalConsultFacade = ReturnType<typeof createLegalConsultModule>["facade"];
