// Процедуры accounts (contract.accounts.*): тонко — authed (домохозяйство из сессии) → сценарий. Канал «Отменить» — сайт.
import { authed } from "../../../platform/http/procedures.ts";
import type { Accounts } from "../application/accounts.ts";

export function accountsRouter(accounts: Accounts) {
  return {
    list: authed.accounts.list.handler(({ context }) => accounts.list(context.s)),
    create: authed.accounts.create.handler(({ input, context }) =>
      accounts.create(context.s, input, "web"),
    ),
    rename: authed.accounts.rename.handler(({ input, context }) =>
      accounts.rename(context.s, input, "web"),
    ),
    setInitialBalance: authed.accounts.setInitialBalance.handler(({ input, context }) =>
      accounts.setInitialBalance(context.s, input, "web"),
    ),
    requestDelete: authed.accounts.requestDelete.handler(async ({ input, context }) => ({
      decisionId: await accounts.requestDelete(context.s, input.id),
    })),
    explain: authed.accounts.explain.handler(async ({ input, context }) => ({
      traceId: await accounts.explain(context.s, input.subject),
    })),
  };
}
