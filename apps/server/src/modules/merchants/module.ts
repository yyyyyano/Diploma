// Модуль merchants (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { LlmFacade } from "../llm/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface MerchantsFacades {
  readonly llm: LlmFacade;
}

export function createMerchantsModule(_deps: ModuleDeps<MerchantsFacades, SystemPlatform>) {
  return defineModule({ id: "merchants" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type MerchantsFacade = ReturnType<typeof createMerchantsModule>["facade"];
