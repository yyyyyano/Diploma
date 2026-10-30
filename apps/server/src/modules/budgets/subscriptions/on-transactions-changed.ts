// transactions.changed → пороги лимитов (BUD-03). Результат ждёт человек («потратил — получил уведомление» ≤ 3 с), поэтому
// без отложенного старта: схлопывание — одна ожидающая задача на пользователя (`short` + ключ), а очередь опрашивается
// раз в 0,5 с. Нагрузке не верим: пересчёт перечитывает расходы месяца целиком, «потерянные» при схлопывании id ничего
// не значат. Импорт на 300 операций — одно событие и один пересчёт.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";
import { transactionsChanged } from "../../transactions/index.ts";

export function onTransactionsChanged(recheck: (s: ScopedDb) => Promise<number>) {
  return defineSubscription({
    event: transactionsChanged,
    module: "budgets",
    options: {
      singletonKey: (_payload, scope) => jobKey(scope, "budgets.recheck-limits"),
      pollingIntervalSeconds: 0.5,
    },
    handle: async (ctx) => {
      await recheck(ctx.s);
    },
  });
}
