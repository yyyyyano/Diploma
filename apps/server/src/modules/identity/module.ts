// Модуль identity (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { MailFacade } from "../mail/index.ts";
import type { PrivacyFacade } from "../privacy/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface IdentityFacades {
  readonly mail: MailFacade;
  readonly privacy: PrivacyFacade;
}

export function createIdentityModule(_deps: ModuleDeps<IdentityFacades, SystemPlatform>) {
  return defineModule({ id: "identity" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type IdentityFacade = ReturnType<typeof createIdentityModule>["facade"];
