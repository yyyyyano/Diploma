// Сценарии budgets на настоящих соседях: операции — transactions (расходы категорий агрегатом, счета и остатки —
// accounts), свободный остаток — настоящий fin на recurring, «Отменить» и «Да/Нет» — настоящий журнал actions, трассы —
// explain. Уведомления — список в памяти (идемпотентный по виду и ключу, как настоящий notify). Время — FakeClock из
// transactions-with-journal (по умолчанию 28.10.2026).
import type { ScopedDb } from "../../platform/db/scoped-db.ts";
import type { TestDb } from "@kosht/testing/db";
import { makeGoals } from "../../modules/budgets/application/goals.ts";
import { makeLimits } from "../../modules/budgets/application/limits.ts";
import { makeOverview } from "../../modules/budgets/application/overview.ts";
import {
  makeRevisions,
  RESTORE_HANDLER,
  UNCONTRIBUTE_HANDLER,
} from "../../modules/budgets/application/revisions.ts";
import { makeThresholds } from "../../modules/budgets/application/thresholds.ts";
import { DELETE_GOAL_HANDLER } from "../../modules/budgets/application/goals.ts";
import { DELETE_LIMIT_HANDLER } from "../../modules/budgets/application/limits.ts";
import type { Deps } from "../../modules/budgets/application/deps.ts";
import { makeOverview as makeDashboard } from "../../modules/dashboard/application/overview.ts";
import type { Deps as DashboardDeps } from "../../modules/dashboard/application/deps.ts";
import { recurringWithJournal } from "./recurring-with-journal.ts";

export { clock, newScope } from "./recurring-with-journal.ts";

export function budgetsWithJournal(db: TestDb) {
  const r = recurringWithJournal(db);
  const deps = {
    platform: r.deps.platform,
    accounts: r.t.accounts,
    transactions: { aggregate: r.t.ops.aggregate },
    categories: r.t.categories,
    fin: { freeBalance: r.fin.calculate },
    notifications: r.deps.notifications,
    actions: r.t.actions,
    explain: r.t.explain,
  } as unknown as Deps;
  const overview = makeOverview(deps);
  const revisions = makeRevisions(deps);
  const thresholds = makeThresholds(deps, overview);
  const limits = makeLimits(deps, overview, revisions, thresholds);
  const goals = makeGoals(deps, overview, revisions, thresholds);
  r.t.registerUndo(RESTORE_HANDLER, revisions.restore);
  r.t.registerUndo(UNCONTRIBUTE_HANDLER, goals.uncontribute);
  r.t.registerConfirm(DELETE_LIMIT_HANDLER, limits.confirmDelete);
  r.t.registerConfirm(DELETE_GOAL_HANDLER, goals.confirmDelete);

  /** Расход в категорию (по умолчанию «Кафе») — настоящая операция. */
  async function spend(s: ScopedDb, on: string, minor: number, category = "cafes"): Promise<void> {
    await r.seed(s, [
      { date: on, merchant: "Кофейня «Зерно»", type: "expense", amountMinor: minor, category },
    ]);
  }

  // dashboard (T-033): те же настоящие соседи, лимиты и цели — настоящие сценарии budgets выше.
  const dashboard = makeDashboard({
    platform: r.t.platform,
    accounts: r.t.accounts,
    transactions: { aggregate: r.t.ops.aggregate },
    fin: { freeBalance: r.fin.calculate },
    budgets: { overview: overview.view },
    recurring: { upcoming: r.read.upcoming },
    // Найденные вычеты — модуль tax (T-046); сценарии дашборда на этом стенде их не создают: настоящие — main/tax-found.int.test.ts.
    tax: { activeFound: async () => [] },
    // События календаря (T-047) — модуль calendar; сценарии дашборда на этом стенде их не создают: настоящие — calendar.int.test.ts.
    calendar: { homeEvents: async () => [] },
    // Итоги недели (T-050) — модуль weekly; сценарии дашборда на этом стенде их не создают: настоящие — weekly.int.test.ts.
    weekly: { latest: async () => null },
    explain: r.t.explain,
  } as unknown as DashboardDeps);

  return {
    dashboard,
    r,
    deps,
    overview,
    limits,
    goals,
    thresholds,
    spend,
    notices: r.notices,
    signals: r.t.signals,
  };
}
