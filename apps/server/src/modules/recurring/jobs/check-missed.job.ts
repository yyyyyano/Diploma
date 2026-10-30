// Проверка одного платежа на «возможно прекращён» (REC-05): ставится ежедневным обходом; дату сверяет по часам под
// scope владельца — нагрузка несёт только id платежа.
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineJob } from "../../../platform/jobs/define-job.ts";

export function checkMissedJob(run: (s: ScopedDb, itemId: string) => Promise<boolean>) {
  return defineJob({
    name: "recurring.check-missed",
    payload: z.object({ itemId: z.uuid() }),
    options: { retryLimit: 2 },
    handle: async (ctx, payload) => {
      await run(ctx.s, payload.itemId);
    },
  });
}
