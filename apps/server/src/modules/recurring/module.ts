// Модуль recurring (паспорт — CLAUDE.md): поиск регулярных платежей по истории операций, разделы и состояния, «возможно
// прекращён» с уведомлением, решения человека с «Отменить», факты профиля «регулярный доход» и «обязательные платежи»
// (REC-01…05, PROF-03). Операции читает через фасад transactions, пересчёт — по событию transactions.changed.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { ExplainFacade } from "../explain/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { ProfileFacade } from "../profile/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import { recurringTools } from "./agent/tools.ts";
import { recurringRouter } from "./api/router.ts";
import { makeCatchUp } from "./application/catch-up.ts";
import { makeDecisions, RESTORE_HANDLER } from "./application/decisions.ts";
import { makeSyncFacts } from "./application/facts.ts";
import { makeMissed } from "./application/missed.ts";
import { makeRead } from "./application/read.ts";
import { makeRecompute } from "./application/recompute.ts";
import { recurringChanged } from "./events.ts";
import { checkMissedJob } from "./jobs/check-missed.job.ts";
import { checkMissedSweep } from "./jobs/check-missed.sweep.ts";
import { RECURRING_SETTINGS } from "./settings.ts";
import { onTransactionsChanged } from "./subscriptions/on-transactions-changed.ts";
import { recurringUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface RecurringFacades {
  readonly transactions: TransactionsFacade;
  readonly categories: CategoriesFacade;
  readonly profile: ProfileFacade;
  readonly notifications: NotificationsFacade;
  readonly actions: ActionsFacade;
  readonly explain: ExplainFacade;
}

export function createRecurringModule({
  platform,
  facades,
}: ModuleDeps<RecurringFacades, Platform>) {
  const deps = {
    platform,
    transactions: facades.transactions,
    profile: facades.profile,
    notifications: facades.notifications,
    actions: facades.actions,
    explain: facades.explain,
  };
  const syncFacts = makeSyncFacts(deps);
  const recompute = makeRecompute(deps, syncFacts);
  const read = makeRead(deps, makeCatchUp(recompute));
  const decisions = makeDecisions(deps, syncFacts);
  const checkMissed = makeMissed(deps, syncFacts);
  const tools = recurringTools(read, () => platform.clock.today());
  const missedJob = checkMissedJob(checkMissed);
  return defineModule({
    id: "recurring",
    // Соседям (fin, dashboard, позже calendar и afford): платежи с суммами Calc и ближайшие платежи.
    facade: { list: read.list, upcoming: read.upcoming },
    router: recurringRouter(read, decisions),
    events: [recurringChanged],
    settings: [...RECURRING_SETTINGS],
    jobs: [missedJob],
    sweeps: [checkMissedSweep(missedJob)],
    subscriptions: [onTransactionsChanged(recompute)],
    tools: [tools.list, tools.upcoming],
    undo: { [RESTORE_HANDLER]: decisions.restore },
    userData: recurringUserData,
  });
}

/** Что модуль даёт соседям: `list(s, { sections?, onDate })` и `upcoming(s, { from, to })` — суммы как `Calc<Money>`. */
export type RecurringFacade = ReturnType<typeof createRecurringModule>["facade"];
