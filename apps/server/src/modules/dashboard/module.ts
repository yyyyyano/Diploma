// Модуль dashboard (паспорт — CLAUDE.md): сборка главного экрана — все числа периода одним ответом с traceId у каждого
// (DASH-01…04, EXPL-01). Своих таблиц нет: данные — фасады accounts, transactions, fin, budgets, recurring; числа — calc.
// Виджеты фаз 5–7 (вычеты, календарь, итоги недели) добавляются в фазе 7 вместе со своими модулями.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { BudgetsFacade } from "../budgets/index.ts";
import type { CalendarFacade } from "../calendar/index.ts";
import type { ExplainFacade } from "../explain/index.ts";
import type { FinFacade } from "../fin/index.ts";
import type { RecurringFacade } from "../recurring/index.ts";
import type { TaxFacade } from "../tax/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { WeeklyFacade } from "../weekly/index.ts";
import { dashboardRouter } from "./api/router.ts";
import { makeOverview } from "./application/overview.ts";

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
  readonly explain: ExplainFacade;
}

export function createDashboardModule({
  platform,
  facades,
}: ModuleDeps<DashboardFacades, Platform>) {
  const overview = makeOverview({ platform, ...facades });
  return defineModule({
    id: "dashboard",
    // Соседям (telegram): те же числа периода — `overview(s, { from?, to? })`.
    facade: { overview: overview.view },
    router: dashboardRouter(overview),
  });
}

/** Что модуль даёт соседям: `overview(s, { from?, to? })` → `DashboardOverview`. */
export type DashboardFacade = ReturnType<typeof createDashboardModule>["facade"];
