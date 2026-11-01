// profile.facts-changed → пересчёт событий по фактам (CAL-02, PROF-07): «есть автомобиль» включает налог и техосмотр, «нет» — убирает
// будущие. Нагрузка — только id фактов; значения перечитываются через фасад profile. Одна ожидающая задача на пользователя.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";
import { factsChanged } from "../../profile/index.ts";

export function onFactsChanged(run: (s: ScopedDb) => Promise<number>) {
  return defineSubscription({
    event: factsChanged,
    module: "calendar",
    options: { singletonKey: (_p, scope) => jobKey(scope, "calendar.sync") },
    handle: async (ctx) => {
      await run(ctx.s);
    },
  });
}
