// Зависимости сценариев budgets: порты платформы и фасады соседей из dependsOn (только то, что нужно сценариям).
import type { Platform } from "../../../platform/module/define-module.ts";
import type { AccountsFacade } from "../../accounts/index.ts";
import type { ActionsFacade } from "../../actions/index.ts";
import type { CategoriesFacade } from "../../categories/index.ts";
import type { ExplainFacade } from "../../explain/index.ts";
import type { FinFacade } from "../../fin/index.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";

export interface Deps {
  readonly platform: Pick<Platform, "clock" | "log" | "realtime" | "settings">;
  readonly accounts: Pick<AccountsFacade, "balances">;
  readonly transactions: Pick<TransactionsFacade, "aggregate">;
  readonly categories: Pick<CategoriesFacade, "list">;
  readonly fin: Pick<FinFacade, "freeBalance">;
  readonly notifications: Pick<NotificationsFacade, "notify">;
  readonly actions: Pick<ActionsFacade, "record" | "propose">;
  readonly explain: Pick<ExplainFacade, "saveMany">;
}

/** Откуда пришло действие: канал, в котором живёт «Отменить». */
export type Channel = "web" | "telegram";
