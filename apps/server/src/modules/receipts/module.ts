// Модуль receipts (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { FilesFacade } from "../files/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { MerchantsFacade } from "../merchants/index.ts";
import type { LlmFacade } from "../llm/index.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { ExplainFacade } from "../explain/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface ReceiptsFacades {
  readonly files: FilesFacade;
  readonly transactions: TransactionsFacade;
  readonly categories: CategoriesFacade;
  readonly merchants: MerchantsFacade;
  readonly llm: LlmFacade;
  readonly actions: ActionsFacade;
  readonly notifications: NotificationsFacade;
  readonly explain: ExplainFacade;
}

export function createReceiptsModule(_deps: ModuleDeps<ReceiptsFacades, Platform>) {
  return defineModule({ id: "receipts" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type ReceiptsFacade = ReturnType<typeof createReceiptsModule>["facade"];
