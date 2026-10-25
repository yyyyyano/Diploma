// Модуль statements (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { FilesFacade } from "../files/index.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { MerchantsFacade } from "../merchants/index.ts";
import type { FxRatesFacade } from "../fx-rates/index.ts";
import type { LlmFacade } from "../llm/index.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface StatementsFacades {
  readonly files: FilesFacade;
  readonly accounts: AccountsFacade;
  readonly transactions: TransactionsFacade;
  readonly categories: CategoriesFacade;
  readonly merchants: MerchantsFacade;
  readonly fxRates: FxRatesFacade;
  readonly llm: LlmFacade;
  readonly actions: ActionsFacade;
  readonly notifications: NotificationsFacade;
}

export function createStatementsModule(_deps: ModuleDeps<StatementsFacades, Platform>) {
  return defineModule({ id: "statements" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type StatementsFacade = ReturnType<typeof createStatementsModule>["facade"];
