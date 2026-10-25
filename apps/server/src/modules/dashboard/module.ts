// Модуль dashboard (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { FinFacade } from "../fin/index.ts";
import type { BudgetsFacade } from "../budgets/index.ts";
import type { RecurringFacade } from "../recurring/index.ts";
import type { CalendarFacade } from "../calendar/index.ts";
import type { TaxFacade } from "../tax/index.ts";
import type { WeeklyFacade } from "../weekly/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface DashboardFacades {
  readonly accounts: AccountsFacade;
  readonly transactions: TransactionsFacade;
  readonly fin: FinFacade;
  readonly budgets: BudgetsFacade;
  readonly recurring: RecurringFacade;
  readonly calendar: CalendarFacade;
  readonly tax: TaxFacade;
  readonly weekly: WeeklyFacade;
}

export function createDashboardModule(_deps: ModuleDeps<DashboardFacades, Platform>) {
  return defineModule({ id: "dashboard" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type DashboardFacade = ReturnType<typeof createDashboardModule>["facade"];
