// norm-tables.values-confirmed → пересчёт автоматических событий (CAL-02, CAL-04): значение, которого не хватало (срок гарантии, срок
// налога), подтверждено — события, ждавшие его, создаются. Событие приходит от имени подтвердившего администратора, поэтому здесь
// пересчитывается его календарь; у остальных пользователей — при открытии календаря и главной (`sync.ensure`).
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";
import { valuesConfirmed } from "../../norm-tables/index.ts";

export function onValuesConfirmed(run: (s: ScopedDb) => Promise<number>) {
  return defineSubscription({
    event: valuesConfirmed,
    module: "calendar",
    options: { singletonKey: (_p, scope) => jobKey(scope, "calendar.sync") },
    handle: async (ctx) => {
      await run(ctx.s);
    },
  });
}
