// Модуль fin (паспорт — CLAUDE.md): свободный остаток (FIN-20, FIN-21) с разбивкой и «Откуда эта цифра?», прогноз остатка по
// дням до конца месяца (FIN-22), факт-предположение «свободный остаток» в профиле (PROF-03). Своих таблиц нет: данные —
// фасады accounts, transactions, recurring, числа — @kosht/calc.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { ExplainFacade } from "../explain/index.ts";
import type { ProfileFacade } from "../profile/index.ts";
import type { RecurringFacade } from "../recurring/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import { finTools } from "./agent/tools.ts";
import { finRouter } from "./api/router.ts";
import { makeForecast } from "./application/forecast.ts";
import { makeFreeBalance } from "./application/free-balance.ts";
import { onRecurringChanged } from "./subscriptions/on-recurring-changed.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface FinFacades {
  readonly accounts: AccountsFacade;
  readonly transactions: TransactionsFacade;
  readonly recurring: RecurringFacade;
  readonly profile: ProfileFacade;
  readonly explain: ExplainFacade;
}

export function createFinModule({ platform, facades }: ModuleDeps<FinFacades, Platform>) {
  const deps = { platform, ...facades };
  const freeBalance = makeFreeBalance(deps);
  const { forecast } = makeForecast(deps);
  const tools = finTools(freeBalance);
  return defineModule({
    id: "fin",
    // Соседям (budgets, afford, dashboard, weekly): расчёты с трассами, прогноз по дням.
    facade: { freeBalance: freeBalance.calculate, forecast },
    router: finRouter(freeBalance),
    subscriptions: [onRecurringChanged(freeBalance.syncFact)],
    tools: [tools.freeBalance],
  });
}

/** Что модуль даёт соседям: `freeBalance(s)` → `FreeBalanceCalc`, `forecast(s, { to? })` → прогноз по дням. */
export type FinFacade = ReturnType<typeof createFinModule>["facade"];
