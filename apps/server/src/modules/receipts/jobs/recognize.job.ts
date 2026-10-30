// Задача receipts.recognize (RCPT-02, NFR-21): распознавание чека в worker — QR, модель, арифметика, перепроверка. В
// нагрузке — только id чека; scope приходит в конверте. Ошибка чтения — состояние чека («не вышло»), а не повтор задачи:
// то же фото не прочтётся с другой попытки, а временную недоступность модели человек повторит сам (загрузкой).
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineJob } from "../../../platform/jobs/define-job.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";

export function recognizeJob(run: (s: ScopedDb, receiptId: string) => Promise<void>) {
  return defineJob({
    name: "receipts.recognize",
    payload: z.object({ receiptId: z.uuid() }),
    options: {
      priority: 10,
      retryLimit: 0,
      // Тот же чек не распознаётся дважды одновременно (повторная постановка схлопывается).
      singletonKey: (payload, scope) => jobKey(scope, payload.receiptId),
    },
    handle: (ctx, payload) => run(ctx.s, payload.receiptId),
  });
}
