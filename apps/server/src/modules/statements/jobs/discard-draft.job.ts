// Брошенный черновик импорта (ночной обход): удаляется, когда не тронут дольше statements.draft-ttl-days. Обход
// (`discard-drafts.sweep.ts`) только находит владельцев; возраст проверяет задача под их scope.
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineJob } from "../../../platform/jobs/define-job.ts";

export function discardDraftJob(run: (s: ScopedDb, importId: string) => Promise<void>) {
  return defineJob({
    name: "statements.discard-draft",
    payload: z.object({ importId: z.uuid() }),
    options: { retryLimit: 0 },
    handle: (ctx, payload) => run(ctx.s, payload.importId),
  });
}
