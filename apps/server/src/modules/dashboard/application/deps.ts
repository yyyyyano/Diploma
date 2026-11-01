// Зависимости сценариев dashboard: порты платформы и фасады соседей из dependsOn (только то, что нужно сценариям).
import type { Platform } from "../../../platform/module/define-module.ts";
import type { AccountsFacade } from "../../accounts/index.ts";
import type { BudgetsFacade } from "../../budgets/index.ts";
import type { ExplainFacade } from "../../explain/index.ts";
import type { FinFacade } from "../../fin/index.ts";
import type { RecurringFacade } from "../../recurring/index.ts";
import type { TaxFacade } from "../../tax/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";

export interface Deps {
  readonly platform: Pick<Platform, "clock" | "log">;
  readonly accounts: Pick<AccountsFacade, "balances">;
  readonly transactions: Pick<TransactionsFacade, "aggregate">;
  readonly fin: Pick<FinFacade, "freeBalance">;
  readonly budgets: Pick<BudgetsFacade, "overview">;
  readonly recurring: Pick<RecurringFacade, "upcoming">;
  readonly tax: Pick<TaxFacade, "activeFound">;
  readonly explain: Pick<ExplainFacade, "saveMany">;
}
