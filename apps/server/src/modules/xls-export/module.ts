// Модуль xls-export (паспорт — CLAUDE.md): Excel с живыми формулами (T-051, XLS-01…04). Данные — фасады соседей (операции, счета,
// категории, лимиты), числа — `@kosht/calc`, книга — ExcelJS в `infrastructure`. Файл собирается по запросу и не хранится.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { BudgetsFacade } from "../budgets/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import { xlsExportTools } from "./agent/tools.ts";
import { xlsExportRouter } from "./api/router.ts";
import { makeExport } from "./application/export.ts";
import { XLS_EXPORT_SETTINGS } from "./settings.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface XlsExportFacades {
  readonly transactions: TransactionsFacade;
  readonly categories: CategoriesFacade;
  readonly budgets: BudgetsFacade;
  readonly accounts: AccountsFacade;
}

export function createXlsExportModule({
  platform,
  facades,
}: ModuleDeps<XlsExportFacades, Platform>) {
  const exporter = makeExport({ platform, ...facades });
  return defineModule({
    id: "xls-export",
    router: xlsExportRouter(exporter),
    settings: [...XLS_EXPORT_SETTINGS],
    tools: [xlsExportTools(exporter).exportExcel],
  });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type XlsExportFacade = ReturnType<typeof createXlsExportModule>["facade"];
