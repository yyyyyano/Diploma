// Модуль fin (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { RecurringFacade } from "../recurring/index.ts";
import type { ProfileFacade } from "../profile/index.ts";
import type { ExplainFacade } from "../explain/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface FinFacades {
  readonly accounts: AccountsFacade;
  readonly transactions: TransactionsFacade;
  readonly recurring: RecurringFacade;
  readonly profile: ProfileFacade;
  readonly explain: ExplainFacade;
}

export function createFinModule(_deps: ModuleDeps<FinFacades, Platform>) {
  return defineModule({ id: "fin" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type FinFacade = ReturnType<typeof createFinModule>["facade"];
