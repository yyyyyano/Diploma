// Модуль xls-export (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { BudgetsFacade } from "../budgets/index.ts";
import type { FilesFacade } from "../files/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface XlsExportFacades {
  readonly transactions: TransactionsFacade;
  readonly categories: CategoriesFacade;
  readonly budgets: BudgetsFacade;
  readonly files: FilesFacade;
}

export function createXlsExportModule(_deps: ModuleDeps<XlsExportFacades, Platform>) {
  return defineModule({ id: "xls-export" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type XlsExportFacade = ReturnType<typeof createXlsExportModule>["facade"];
