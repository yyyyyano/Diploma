// Проверка одной цели (BUD-07): 50/100 % и «отстаёт от графика»; ставится ежедневным обходом, дату сверяет по часам под
// scope владельца — нагрузка несёт только id цели.
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineJob } from "../../../platform/jobs/define-job.ts";

export function checkGoalJob(run: (s: ScopedDb, goalId: string) => Promise<number>) {
  return defineJob({
    name: "budgets.check-goal",
    payload: z.object({ goalId: z.uuid() }),
    options: { retryLimit: 2 },
    handle: async (ctx, payload) => {
      await run(ctx.s, payload.goalId);
    },
  });
}
