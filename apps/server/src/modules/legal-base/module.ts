// Модуль legal-base (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { LlmFacade } from "../llm/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { IdentityFacade } from "../identity/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface LegalBaseFacades {
  readonly llm: LlmFacade;
  readonly notifications: NotificationsFacade;
  readonly identity: IdentityFacade;
}

export function createLegalBaseModule(_deps: ModuleDeps<LegalBaseFacades, SystemPlatform>) {
  return defineModule({ id: "legal-base" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type LegalBaseFacade = ReturnType<typeof createLegalBaseModule>["facade"];
