// Задача transactions.categorize (CAT-06): модель подбирает категорию операциям, которые правила не покрыли. В
// нагрузке — только id; модель зовётся пачкой в worker, вне транзакции. Ошибка модели — не ошибка задачи: категория
// остаётся «Прочее» (fallback), повторов нет.
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineJob } from "../../../platform/jobs/define-job.ts";

export function categorizeJob(run: (s: ScopedDb, ids: readonly string[]) => Promise<void>) {
  return defineJob({
    name: "transactions.categorize",
    payload: z.object({ ids: z.array(z.uuid()).min(1).max(1000) }),
    options: { retryLimit: 0, startAfterSeconds: 2 },
    handle: (ctx, payload) => run(ctx.s, payload.ids),
  });
}
