// recurring.changed → факт-предположение «свободный остаток» в профиле (PROF-03, FIN-20). Нагрузке не верим: факт
// пересчитывается из регулярных платежей целиком; ключ схлопывания — пользователь, повтор ничего не пишет (идемпотентно).
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";
import { recurringChanged } from "../../recurring/index.ts";

export function onRecurringChanged(syncFact: (s: ScopedDb) => Promise<void>) {
  return defineSubscription({
    event: recurringChanged,
    module: "fin",
    options: {
      singletonKey: (_payload, scope) => jobKey(scope, "fin.sync-free-balance"),
      startAfterSeconds: 1,
    },
    handle: async (ctx) => {
      await syncFact(ctx.s);
    },
  });
}
