// Модуль categories (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { MerchantsFacade } from "../merchants/index.ts";
import type { LlmFacade } from "../llm/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface CategoriesFacades {
  readonly merchants: MerchantsFacade;
  readonly llm: LlmFacade;
}

export function createCategoriesModule(_deps: ModuleDeps<CategoriesFacades, SystemPlatform>) {
  return defineModule({ id: "categories" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type CategoriesFacade = ReturnType<typeof createCategoriesModule>["facade"];
