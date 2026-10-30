// Зависимости сценариев recurring: порты платформы и фасады соседей из dependsOn (только то, что нужно сценариям).
import type { Platform } from "../../../platform/module/define-module.ts";
import type { ActionsFacade } from "../../actions/index.ts";
import type { ExplainFacade } from "../../explain/index.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import type { ProfileFacade } from "../../profile/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";

export interface Deps {
  readonly platform: Pick<Platform, "clock" | "log" | "events" | "realtime" | "settings">;
  readonly transactions: Pick<TransactionsFacade, "recurringHistory">;
  readonly profile: Pick<ProfileFacade, "getFacts" | "upsertDerivedFact">;
  readonly notifications: Pick<NotificationsFacade, "notify">;
  readonly actions: Pick<ActionsFacade, "record">;
  readonly explain: Pick<ExplainFacade, "save">;
}

/** Откуда пришло действие: канал, в котором живёт «Отменить». */
export type Channel = "web" | "telegram";
