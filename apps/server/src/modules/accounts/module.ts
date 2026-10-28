// Модуль accounts (паспорт — CLAUDE.md): счета, «Наличные» с самого начала, «Карта, не указана» по требованию, остатки
// с датой и итоги в BYN по курсу НБРБ (STMT-01, STMT-02, STMT-09); «Отменить» и подтверждение удаления — через actions.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { ExplainFacade } from "../explain/index.ts";
import type { FxRatesFacade } from "../fx-rates/index.ts";
import type { IdentityFacade } from "../identity/index.ts";
import { accountsTools } from "./agent/tools.ts";
import { accountsRouter } from "./api/router.ts";
import { DELETE_HANDLER, makeAccounts, RESTORE_HANDLER } from "./application/accounts.ts";
import { makeEnsureCash } from "./application/ensure-cash.ts";
import { balancesChanged } from "./events.ts";
import { onUserRegistered } from "./subscriptions/on-user-registered.ts";
import { accountsUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface AccountsFacades {
  readonly identity: IdentityFacade;
  readonly fxRates: FxRatesFacade;
  readonly explain: ExplainFacade;
  readonly actions: ActionsFacade;
}

export function createAccountsModule({ platform, facades }: ModuleDeps<AccountsFacades, Platform>) {
  const accounts = makeAccounts({
    platform,
    actions: facades.actions,
    fxRates: facades.fxRates,
    explain: facades.explain,
  });
  const tools = accountsTools(accounts);
  return defineModule({
    id: "accounts",
    facade: {
      findOrCreate: accounts.findOrCreate,
      applyBalanceChange: accounts.applyBalanceChange,
      currencyOf: accounts.currencyOf,
      cash: accounts.cash,
      unknownCard: accounts.unknownCard,
    },
    router: accountsRouter(accounts),
    events: [balancesChanged],
    subscriptions: [onUserRegistered(makeEnsureCash(platform))],
    tools: [tools.list, tools.create, tools.rename, tools.remove],
    undo: { [RESTORE_HANDLER]: accounts.restore },
    confirm: { [DELETE_HANDLER]: accounts.confirmDelete },
    userData: accountsUserData,
  });
}

/** Что модуль даёт соседям (transactions, statements, receipts): карта банка, остаток, служебные счета. */
export type AccountsFacade = ReturnType<typeof createAccountsModule>["facade"];
