// Модуль budgets (паспорт — CLAUDE.md): лимиты по категориям с порогами 80/100 %, цели — копилка или привязка к счёту,
// рекомендуемый взнос, уведомления о прогрессе и отставании от графика (BUD-01…07). Расходы читает агрегатом transactions,
// свободный остаток — фасад fin, остатки счетов — accounts; пересчёт порогов — по событиям transactions.changed и
// accounts.balances-changed, «отстаёт» — ежедневный обход.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { ExplainFacade } from "../explain/index.ts";
import type { FinFacade } from "../fin/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import { budgetsTools } from "./agent/tools.ts";
import { budgetsRouter } from "./api/router.ts";
import { DELETE_GOAL_HANDLER, makeGoals } from "./application/goals.ts";
import { DELETE_LIMIT_HANDLER, makeLimits } from "./application/limits.ts";
import { makeOverview } from "./application/overview.ts";
import { makeRevisions, RESTORE_HANDLER, UNCONTRIBUTE_HANDLER } from "./application/revisions.ts";
import { makeThresholds } from "./application/thresholds.ts";
import { checkGoalJob } from "./jobs/check-goal.job.ts";
import { checkGoalSweep } from "./jobs/check-goal.sweep.ts";
import { BUDGETS_SETTINGS } from "./settings.ts";
import { onBalancesChanged } from "./subscriptions/on-balances-changed.ts";
import { onTransactionsChanged } from "./subscriptions/on-transactions-changed.ts";
import { budgetsUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface BudgetsFacades {
  readonly accounts: AccountsFacade;
  readonly transactions: TransactionsFacade;
  readonly categories: CategoriesFacade;
  readonly fin: FinFacade;
  readonly notifications: NotificationsFacade;
  readonly actions: ActionsFacade;
  readonly explain: ExplainFacade;
}

export function createBudgetsModule({ platform, facades }: ModuleDeps<BudgetsFacades, Platform>) {
  const deps = { platform, ...facades };
  const overview = makeOverview(deps);
  const revisions = makeRevisions(deps);
  const thresholds = makeThresholds(deps, overview);
  const limits = makeLimits(deps, overview, revisions, thresholds);
  const goals = makeGoals(deps, overview, revisions, thresholds);
  const tools = budgetsTools(overview, limits, goals);
  const goalJob = checkGoalJob(thresholds.checkGoal);
  return defineModule({
    id: "budgets",
    // Соседям (dashboard, afford, weekly, telegram): лимиты месяца и цели с прогрессом и traceId.
    facade: { overview: overview.view },
    router: budgetsRouter(overview, limits, goals),
    settings: [...BUDGETS_SETTINGS],
    jobs: [goalJob],
    sweeps: [checkGoalSweep(goalJob)],
    subscriptions: [
      onTransactionsChanged(thresholds.recheckLimits),
      onBalancesChanged(thresholds.recheckGoals),
    ],
    tools: [
      tools.list,
      tools.setLimit,
      tools.createGoal,
      tools.contribute,
      tools.deleteLimit,
      tools.deleteGoal,
    ],
    undo: { [RESTORE_HANDLER]: revisions.restore, [UNCONTRIBUTE_HANDLER]: goals.uncontribute },
    confirm: {
      [DELETE_LIMIT_HANDLER]: limits.confirmDelete,
      [DELETE_GOAL_HANDLER]: goals.confirmDelete,
    },
    userData: budgetsUserData,
  });
}

/** Что модуль даёт соседям: `overview(s, month?)` → лимиты месяца и цели с прогрессом, числа с `traceId`. */
export type BudgetsFacade = ReturnType<typeof createBudgetsModule>["facade"];
