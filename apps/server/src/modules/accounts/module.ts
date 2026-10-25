// Модуль accounts (паспорт — CLAUDE.md): счета домохозяйства и «Наличные» с самого начала (STMT-01).
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { IdentityFacade } from "../identity/index.ts";
import type { FxRatesFacade } from "../fx-rates/index.ts";
import type { ExplainFacade } from "../explain/index.ts";
import { listAccountsTool } from "./agent/tools.ts";
import { accountsRouter } from "./api/router.ts";
import { makeEnsureCash } from "./application/ensure-cash.ts";
import { onUserRegistered } from "./subscriptions/on-user-registered.ts";
import { accountsUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface AccountsFacades {
  readonly identity: IdentityFacade;
  readonly fxRates: FxRatesFacade;
  readonly explain: ExplainFacade;
}

export function createAccountsModule({ platform }: ModuleDeps<AccountsFacades, Platform>) {
  return defineModule({
    id: "accounts",
    router: accountsRouter(),
    subscriptions: [onUserRegistered(makeEnsureCash(platform))],
    tools: [listAccountsTool],
    userData: accountsUserData,
  });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type AccountsFacade = ReturnType<typeof createAccountsModule>["facade"];
