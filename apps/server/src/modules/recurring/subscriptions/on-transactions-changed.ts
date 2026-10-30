// transactions.changed → пересчёт регулярных платежей (REC-01). События схлопываются по ключу «пользователь» с короткой
// задержкой: импорт на 300 операций — один пересчёт. Нагрузке не верим и ключ от неё не зависит: пересчёт перечитывает
// историю целиком, поэтому «потерянные» при схлопывании id ничего не значат.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";
import { transactionsChanged } from "../../transactions/index.ts";

export function onTransactionsChanged(recompute: (s: ScopedDb) => Promise<string[]>) {
  return defineSubscription({
    event: transactionsChanged,
    module: "recurring",
    options: {
      singletonKey: (_payload, scope) => jobKey(scope, "recurring.recompute"),
      startAfterSeconds: 2,
    },
    handle: async (ctx) => {
      await recompute(ctx.s);
    },
  });
}
