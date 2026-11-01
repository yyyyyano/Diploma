// Модуль afford (паспорт — CLAUDE.md): «Могу ли я позволить покупку?» (T-049, AFF-01…08) — три сценария покупки с прогнозом
// остатка по дням, просадки и безопасный платёж по ПДН. Своих таблиц нет: данные — фасады соседей, числа — `@kosht/calc`,
// каждое показываемое число сохраняет explain.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { RecurringFacade } from "../recurring/index.ts";
import type { FinFacade } from "../fin/index.ts";
import type { BudgetsFacade } from "../budgets/index.ts";
import type { CalendarFacade } from "../calendar/index.ts";
import type { NormTablesFacade } from "../norm-tables/index.ts";
import type { ProfileFacade } from "../profile/index.ts";
import type { ExplainFacade } from "../explain/index.ts";
import { affordTools } from "./agent/tools.ts";
import { affordRouter } from "./api/router.ts";
import { makeSafeLoan } from "./application/safe-loan.ts";
import { makeScenarios } from "./application/scenarios.ts";
import { AFFORD_SETTINGS } from "./settings.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface AffordFacades {
  readonly accounts: AccountsFacade;
  readonly transactions: TransactionsFacade;
  readonly recurring: RecurringFacade;
  readonly fin: FinFacade;
  readonly budgets: BudgetsFacade;
  readonly calendar: CalendarFacade;
  readonly normTables: NormTablesFacade;
  readonly profile: ProfileFacade;
  readonly explain: ExplainFacade;
}

export function createAffordModule({ platform, facades }: ModuleDeps<AffordFacades, Platform>) {
  const deps = { platform, ...facades };
  const scenarios = makeScenarios(deps);
  const safeLoan = makeSafeLoan(deps);
  const tools = affordTools(scenarios, safeLoan);
  return defineModule({
    id: "afford",
    // Соседям: расчёт сценариев и безопасного платежа (дашборд, итоги недели) тем же кодом, что у сайта и агента.
    facade: { scenarios, safeLoan },
    router: affordRouter(scenarios, safeLoan),
    settings: [...AFFORD_SETTINGS],
    tools: [tools.affordScenarios, tools.safeLoanPayment],
  });
}

/** Что модуль даёт соседям: `scenarios(s, input)` → `AffordResult`, `safeLoan(s, input)` → `SafeLoanResult`. */
export type AffordFacade = ReturnType<typeof createAffordModule>["facade"];
