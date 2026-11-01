// transactions.changed → пересчёт календаря (PROF-07, CAL-05): новые операции могут быть признаком имущества (топливо, налог) или годовым
// платежом страховщику — вопрос «У вас есть автомобиль?» и «Напомнить о продлении ОСАГО?» не ждёт открытия календаря. Нагрузка — только id
// операций; операции перечитываются через фасад. Одна ожидающая задача на пользователя.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";
import { transactionsChanged } from "../../transactions/index.ts";

export function onTransactionsChanged(run: (s: ScopedDb) => Promise<number>) {
  return defineSubscription({
    event: transactionsChanged,
    module: "calendar",
    options: { singletonKey: (_p, scope) => jobKey(scope, "calendar.sync") },
    handle: async (ctx) => {
      await run(ctx.s);
    },
  });
}
