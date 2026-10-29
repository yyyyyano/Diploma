// Модуль transactions (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { MerchantsFacade } from "../merchants/index.ts";
import type { FxRatesFacade } from "../fx-rates/index.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { ExplainFacade } from "../explain/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import { transactionsUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface TransactionsFacades {
  readonly accounts: AccountsFacade;
  readonly categories: CategoriesFacade;
  readonly merchants: MerchantsFacade;
  readonly fxRates: FxRatesFacade;
  readonly actions: ActionsFacade;
  readonly explain: ExplainFacade;
  readonly notifications: NotificationsFacade;
}

export function createTransactionsModule(_deps: ModuleDeps<TransactionsFacades, Platform>) {
  return defineModule({ id: "transactions", userData: transactionsUserData });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type TransactionsFacade = ReturnType<typeof createTransactionsModule>["facade"];
