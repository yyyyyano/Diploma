// Зависимости сценариев fin: порты платформы и фасады соседей из dependsOn.
import type { Platform } from "../../../platform/module/define-module.ts";
import type { AccountsFacade } from "../../accounts/index.ts";
import type { ExplainFacade } from "../../explain/index.ts";
import type { ProfileFacade } from "../../profile/index.ts";
import type { RecurringFacade } from "../../recurring/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";

export interface Deps {
  readonly platform: Pick<Platform, "clock" | "log">;
  readonly accounts: Pick<AccountsFacade, "balances">;
  readonly transactions: Pick<TransactionsFacade, "firstOperationOn">;
  readonly recurring: Pick<RecurringFacade, "list" | "upcoming">;
  readonly profile: Pick<ProfileFacade, "getFacts" | "upsertDerivedFact">;
  readonly explain: Pick<ExplainFacade, "saveMany">;
}
