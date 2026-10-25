// Модуль budgets (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { FinFacade } from "../fin/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { ExplainFacade } from "../explain/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface BudgetsFacades {
  readonly accounts: AccountsFacade;
  readonly transactions: TransactionsFacade;
  readonly categories: CategoriesFacade;
  readonly fin: FinFacade;
  readonly notifications: NotificationsFacade;
  readonly actions: ActionsFacade;
  readonly explain: ExplainFacade;
}

export function createBudgetsModule(_deps: ModuleDeps<BudgetsFacades, Platform>) {
  return defineModule({ id: "budgets" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type BudgetsFacade = ReturnType<typeof createBudgetsModule>["facade"];
