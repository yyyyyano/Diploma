// Зависимости сценариев xls-export: порты платформы и фасады соседей из dependsOn (только то, что нужно сценариям).
import type { Platform } from "../../../platform/module/define-module.ts";
import type { AccountsFacade } from "../../accounts/index.ts";
import type { BudgetsFacade } from "../../budgets/index.ts";
import type { CategoriesFacade } from "../../categories/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";

export interface Deps {
  readonly platform: Pick<Platform, "clock" | "log" | "settings">;
  readonly transactions: Pick<TransactionsFacade, "list">;
  readonly categories: Pick<CategoriesFacade, "list">;
  readonly budgets: Pick<BudgetsFacade, "overview">;
  readonly accounts: Pick<AccountsFacade, "list">;
}
