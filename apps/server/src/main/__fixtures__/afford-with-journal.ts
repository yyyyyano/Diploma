// Сценарии afford на настоящих соседях: recurring, fin (остаток и прогноз), accounts (остатки), transactions (расходы по месяцам),
// calendar (события с суммой — настоящие хранимые), budgets (цели — настоящие), norm-tables (пределы ПДН — настоящие строки
// миграции: до «Подтвердить» они ждут), actions и explain. Время — FakeClock из transactions-with-journal (по умолчанию
// 28.10.2026). Ответ пользователя и подтверждение пределов — как в жизни: через сценарии модулей, а не заглушки.
import type { TestDb } from "@kosht/testing/db";
import { testScope } from "@kosht/testing";
import { createScopedDb, type ScopedDb } from "../../platform/db/scoped-db.ts";
import { createSystemDb } from "../../platform/db/system-db.ts";
import { makeScenarios } from "../../modules/afford/application/scenarios.ts";
import { makeSafeLoan } from "../../modules/afford/application/safe-loan.ts";
import { affordTools } from "../../modules/afford/agent/tools.ts";
import type { Deps } from "../../modules/afford/application/deps.ts";
import { makeGoals } from "../../modules/budgets/application/goals.ts";
import { makeOverview } from "../../modules/budgets/application/overview.ts";
import {
  makeRevisions,
  RESTORE_HANDLER,
  UNCONTRIBUTE_HANDLER,
} from "../../modules/budgets/application/revisions.ts";
import { makeThresholds } from "../../modules/budgets/application/thresholds.ts";
import type { Deps as BudgetsDeps } from "../../modules/budgets/application/deps.ts";
import { makeRates } from "../../modules/norm-tables/application/rates.ts";

import { calendarWithJournal, clock } from "./calendar-with-journal.ts";

export { clock };

export function affordWithJournal(db: TestDb) {
  const c = calendarWithJournal(db);
  const r = c.r;
  const rates = makeRates({
    system: createSystemDb(db.pool),
    legalBase: { fragmentsUnder: async () => [] },
    clock,
    publishConfirmed: async () => {},
  });
  const budgetsDeps = {
    platform: r.deps.platform,
    accounts: r.t.accounts,
    transactions: { aggregate: r.t.ops.aggregate },
    categories: r.t.categories,
    fin: { freeBalance: r.fin.calculate },
    notifications: r.deps.notifications,
    actions: r.t.actions,
    explain: r.t.explain,
  } as unknown as BudgetsDeps;
  const overview = makeOverview(budgetsDeps);
  const revisions = makeRevisions(budgetsDeps);
  const thresholds = makeThresholds(budgetsDeps, overview);
  const goals = makeGoals(budgetsDeps, overview, revisions, thresholds);
  r.t.registerUndo(RESTORE_HANDLER, revisions.restore);
  r.t.registerUndo(UNCONTRIBUTE_HANDLER, goals.uncontribute);

  const deps = {
    platform: r.deps.platform,
    accounts: r.t.accounts,
    transactions: { aggregate: r.t.ops.aggregate },
    recurring: { upcoming: r.read.upcoming },
    fin: { freeBalance: r.fin.calculate, forecast: r.fin.forecast },
    budgets: { overview: overview.view },
    calendar: { range: c.read.range },
    normTables: { rate: rates.value },
    explain: r.t.explain,
  } as unknown as Deps;
  const scenarios = makeScenarios(deps);
  const safeLoan = makeSafeLoan(deps);

  /** Подтверждает пределы ПДН (строки миграции ждут «Подтвердить», ADM-11): как администратор через `norm-tables`. */
  async function confirmPdn(): Promise<void> {
    const admin: ScopedDb = createScopedDb(db.pool, testScope({ user: 9000, household: 9000 }));
    const { items } = await rates.table();
    for (const item of items) {
      if (item.param.startsWith("pdn.") && item.status === "pending") {
        await rates.confirm(admin, item.id);
      }
    }
  }

  return {
    c,
    r,
    s: r.s,
    goals,
    scenarios,
    safeLoan,
    confirmPdn,
    tools: affordTools(scenarios, safeLoan),
  };
}
