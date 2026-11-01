// Напоминания календаря (CAL-07, NFR-22): задача ставится минутным обходом владельцам неотправленных напоминаний; срок сверяет
// по часам под scope владельца — нагрузка несёт только id. Одна ожидающая задача на пользователя.
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineJob } from "../../../platform/jobs/define-job.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";

export function deliverJob(run: (s: ScopedDb) => Promise<number>) {
  return defineJob({
    name: "calendar.deliver-reminders",
    payload: z.object({ reminderId: z.uuid() }),
    options: {
      retryLimit: 2,
      singletonKey: (_payload, scope) => jobKey(scope, "calendar.deliver-reminders"),
    },
    handle: async (ctx) => {
      await run(ctx.s);
    },
  });
}
