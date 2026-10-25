// Модуль norm-tables (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { LegalBaseFacade } from "../legal-base/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface NormTablesFacades {
  readonly legalBase: LegalBaseFacade;
  readonly notifications: NotificationsFacade;
}

export function createNormTablesModule(_deps: ModuleDeps<NormTablesFacades, SystemPlatform>) {
  return defineModule({ id: "norm-tables" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type NormTablesFacade = ReturnType<typeof createNormTablesModule>["facade"];
