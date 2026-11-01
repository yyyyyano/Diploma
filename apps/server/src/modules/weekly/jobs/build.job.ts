// Итоги недели одного пользователя (WEEK-01, NFR-22): задача ставится обходом владельцам включённых сводок; срок и неделю сверяет
// сама по часам под scope владельца — нагрузка несёт только id. Одна ожидающая задача на пользователя.
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineJob } from "../../../platform/jobs/define-job.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";

export function buildJob(run: (s: ScopedDb) => Promise<unknown>) {
  return defineJob({
    name: "weekly.build-summary",
    payload: z.object({ preferenceId: z.uuid() }),
    options: {
      retryLimit: 2,
      singletonKey: (_payload, scope) => jobKey(scope, "weekly.build-summary"),
    },
    handle: async (ctx) => {
      await run(ctx.s);
    },
  });
}
