// Модуль accounts (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { IdentityFacade } from "../identity/index.ts";
import type { FxRatesFacade } from "../fx-rates/index.ts";
import type { ExplainFacade } from "../explain/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface AccountsFacades {
  readonly identity: IdentityFacade;
  readonly fxRates: FxRatesFacade;
  readonly explain: ExplainFacade;
}

export function createAccountsModule(_deps: ModuleDeps<AccountsFacades, Platform>) {
  return defineModule({ id: "accounts" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type AccountsFacade = ReturnType<typeof createAccountsModule>["facade"];
