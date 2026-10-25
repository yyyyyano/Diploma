// Процедуры accounts (contract.accounts.*): тонко — authed (домохозяйство из сессии) → сценарий.
import { authed } from "../../../platform/http/procedures.ts";
import { listAccountItems } from "../application/list-accounts.ts";

export function accountsRouter() {
  return {
    list: authed.accounts.list.handler(({ context }) => listAccountItems(context.s)),
  };
}
