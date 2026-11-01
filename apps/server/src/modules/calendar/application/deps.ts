// Зависимости сценариев calendar: порты платформы и фасады соседей из dependsOn (только то, что нужно сценариям).
import type { Platform } from "../../../platform/module/define-module.ts";
import type { ActionsFacade } from "../../actions/index.ts";
import type { ExplainFacade } from "../../explain/index.ts";
import type { NormTablesFacade } from "../../norm-tables/index.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import type { ReceiptsFacade } from "../../receipts/index.ts";
import type { RecurringFacade } from "../../recurring/index.ts";

export interface Deps {
  readonly platform: Pick<Platform, "clock" | "log" | "realtime" | "settings">;
  readonly recurring: Pick<RecurringFacade, "list" | "upcoming">;
  readonly receipts: Pick<ReceiptsFacade, "warrantyItems">;
  readonly normTables: Pick<NormTablesFacade, "rate">;
  readonly notifications: Pick<NotificationsFacade, "notify">;
  readonly actions: Pick<ActionsFacade, "record" | "propose">;
  readonly explain: Pick<ExplainFacade, "saveMany">;
}

/** Откуда пришло действие: канал, в котором живёт «Отменить». */
export type Channel = "web" | "telegram";

/** Кто создал событие: человек на сайте или ассистент по его просьбе (CAL-06). */
export type Via = "site" | "chat";
