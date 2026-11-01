// Зависимости сценариев afford: порты платформы и фасады соседей из dependsOn (только то, что нужно сценариям).
import type { Platform } from "../../../platform/module/define-module.ts";
import type { AccountsFacade } from "../../accounts/index.ts";
import type { BudgetsFacade } from "../../budgets/index.ts";
import type { CalendarFacade } from "../../calendar/index.ts";
import type { ExplainFacade } from "../../explain/index.ts";
import type { FinFacade } from "../../fin/index.ts";
import type { NormTablesFacade } from "../../norm-tables/index.ts";
import type { RecurringFacade } from "../../recurring/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";

export interface Deps {
  readonly platform: Pick<Platform, "clock" | "settings">;
  readonly accounts: Pick<AccountsFacade, "balances">;
  readonly transactions: Pick<TransactionsFacade, "aggregate">;
  readonly recurring: Pick<RecurringFacade, "upcoming">;
  readonly fin: Pick<FinFacade, "freeBalance" | "forecast">;
  readonly budgets: Pick<BudgetsFacade, "overview">;
  readonly calendar: Pick<CalendarFacade, "range">;
  readonly normTables: Pick<NormTablesFacade, "rate">;
  readonly explain: Pick<ExplainFacade, "saveMany">;
}
