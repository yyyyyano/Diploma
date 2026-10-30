// Зависимости сценариев transactions: порты платформы и фасады соседей из dependsOn (только то, что нужно сценариям).
import type { Settings } from "../../../platform/settings/settings.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { JobDef } from "../../../platform/jobs/define-job.ts";
import type { AccountsFacade } from "../../accounts/index.ts";
import type { ActionsFacade } from "../../actions/index.ts";
import type { CategoriesFacade } from "../../categories/index.ts";
import type { ExplainFacade } from "../../explain/index.ts";
import type { FxRatesFacade } from "../../fx-rates/index.ts";
import type { MerchantsFacade } from "../../merchants/index.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import type { Ledger } from "./ledger.ts";
import type { Prepare } from "./prepare.ts";

export interface Deps {
  readonly platform: Pick<Platform, "clock" | "log" | "jobs" | "events" | "realtime">;
  readonly accounts: Pick<
    AccountsFacade,
    "currencyOf" | "cash" | "applyBalanceChange" | "unknownCard" | "findCardByMask"
  >;
  readonly categories: Pick<
    CategoriesFacade,
    "list" | "byRules" | "categorize" | "setUserRule" | "userRule" | "removeUserRule"
  >;
  readonly merchants: Pick<MerchantsFacade, "resolve" | "similarity">;
  readonly fxRates: Pick<FxRatesFacade, "convert" | "rateOn">;
  readonly actions: Pick<ActionsFacade, "record" | "propose">;
  readonly explain: Pick<ExplainFacade, "save" | "saveMany">;
  readonly notifications: Pick<NotificationsFacade, "notify">;
  readonly settings: Pick<Settings, "get">;
}

/** Фоновые задачи модуля: ставятся в транзакции действия (откат — задачи нет). */
export interface JobRefs {
  readonly fillRates: JobDef<{ ids: string[] }>;
  readonly categorize: JobDef<{ ids: string[] }>;
}

/** Общие части сценариев, собранные один раз в module.ts. */
export interface Parts {
  readonly prepare: Prepare;
  readonly ledger: Ledger;
  readonly jobs: JobRefs;
}

/** Откуда пришло действие: канал («Отменить» в нём) и источник операции в таблице. */
export interface Origin {
  readonly channel: "web" | "telegram";
  readonly source: "manual" | "assistant";
}
