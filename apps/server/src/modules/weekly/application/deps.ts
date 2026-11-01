// Зависимости сценариев weekly: порты платформы и фасады соседей из dependsOn (только то, что нужно сценариям).
import type { Platform } from "../../../platform/module/define-module.ts";
import type { BudgetsFacade } from "../../budgets/index.ts";
import type { CalendarFacade } from "../../calendar/index.ts";
import type { CategoriesFacade } from "../../categories/index.ts";
import type { ExplainFacade } from "../../explain/index.ts";
import type { LlmFacade } from "../../llm/index.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import type { TaxFacade } from "../../tax/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";

export interface Deps {
  readonly platform: Pick<Platform, "clock" | "log" | "settings">;
  readonly transactions: Pick<TransactionsFacade, "aggregate" | "firstOperationOn">;
  readonly budgets: Pick<BudgetsFacade, "overview">;
  readonly calendar: Pick<CalendarFacade, "range">;
  readonly tax: Pick<TaxFacade, "activeFound">;
  readonly categories: Pick<CategoriesFacade, "list">;
  readonly llm: Pick<LlmFacade, "extract">;
  readonly notifications: Pick<NotificationsFacade, "notify">;
  readonly explain: Pick<ExplainFacade, "saveMany">;
}
