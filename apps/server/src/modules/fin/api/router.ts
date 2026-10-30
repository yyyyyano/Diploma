// Процедуры fin (contract.fin.*): тонко — authed (домохозяйство из сессии) → сценарий.
import { authed } from "../../../platform/http/procedures.ts";
import type { FreeBalanceScenario } from "../application/free-balance.ts";

export function finRouter(freeBalance: FreeBalanceScenario) {
  return {
    freeBalance: authed.fin.freeBalance.handler(({ context }) => freeBalance.view(context.s)),
  };
}
