// Модуль privacy (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type NoFacades,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export type PrivacyFacades = NoFacades;

export function createPrivacyModule(_deps: ModuleDeps<PrivacyFacades, SystemPlatform>) {
  return defineModule({ id: "privacy" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type PrivacyFacade = ReturnType<typeof createPrivacyModule>["facade"];
