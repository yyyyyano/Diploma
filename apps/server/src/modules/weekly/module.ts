// Модуль weekly (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { BudgetsFacade } from "../budgets/index.ts";
import type { CalendarFacade } from "../calendar/index.ts";
import type { RecurringFacade } from "../recurring/index.ts";
import type { TaxFacade } from "../tax/index.ts";
import type { LlmFacade } from "../llm/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { ExplainFacade } from "../explain/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface WeeklyFacades {
  readonly transactions: TransactionsFacade;
  readonly budgets: BudgetsFacade;
  readonly calendar: CalendarFacade;
  readonly recurring: RecurringFacade;
  readonly tax: TaxFacade;
  readonly llm: LlmFacade;
  readonly notifications: NotificationsFacade;
  readonly explain: ExplainFacade;
}

export function createWeeklyModule(_deps: ModuleDeps<WeeklyFacades, Platform>) {
  return defineModule({ id: "weekly" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type WeeklyFacade = ReturnType<typeof createWeeklyModule>["facade"];
