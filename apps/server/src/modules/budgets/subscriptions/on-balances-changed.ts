// accounts.balances-changed → прогресс целей «по счёту» (BUD-04): после импорта выписки с новым остатком прогресс и
// пороги 50/100 % обновляются сами. Схлопывание — одна ожидающая задача на пользователя; нагрузке не верим.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";
import { balancesChanged } from "../../accounts/index.ts";

export function onBalancesChanged(recheck: (s: ScopedDb) => Promise<number>) {
  return defineSubscription({
    event: balancesChanged,
    module: "budgets",
    options: {
      singletonKey: (_payload, scope) => jobKey(scope, "budgets.recheck-goals"),
    },
    handle: async (ctx) => {
      await recheck(ctx.s);
    },
  });
}
