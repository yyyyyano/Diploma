// Модуль calendar (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { ProfileFacade } from "../profile/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { RecurringFacade } from "../recurring/index.ts";
import type { ReceiptsFacade } from "../receipts/index.ts";
import type { NormTablesFacade } from "../norm-tables/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { ActionsFacade } from "../actions/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface CalendarFacades {
  readonly profile: ProfileFacade;
  readonly transactions: TransactionsFacade;
  readonly recurring: RecurringFacade;
  readonly receipts: ReceiptsFacade;
  readonly normTables: NormTablesFacade;
  readonly notifications: NotificationsFacade;
  readonly actions: ActionsFacade;
}

export function createCalendarModule(_deps: ModuleDeps<CalendarFacades, Platform>) {
  return defineModule({ id: "calendar" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type CalendarFacade = ReturnType<typeof createCalendarModule>["facade"];
