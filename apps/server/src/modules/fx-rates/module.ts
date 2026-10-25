// Модуль fx-rates (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { ExplainFacade } from "../explain/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface FxRatesFacades {
  readonly explain: ExplainFacade;
}

export function createFxRatesModule(_deps: ModuleDeps<FxRatesFacades, SystemPlatform>) {
  return defineModule({ id: "fx-rates" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type FxRatesFacade = ReturnType<typeof createFxRatesModule>["facade"];
