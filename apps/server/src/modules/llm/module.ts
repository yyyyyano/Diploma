// Модуль llm (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { PrivacyFacade } from "../privacy/index.ts";
import type { IdentityFacade } from "../identity/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface LlmFacades {
  readonly privacy: PrivacyFacade;
  readonly identity: IdentityFacade;
  readonly notifications: NotificationsFacade;
}

export function createLlmModule(_deps: ModuleDeps<LlmFacades, SystemPlatform>) {
  return defineModule({ id: "llm" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type LlmFacade = ReturnType<typeof createLlmModule>["facade"];
