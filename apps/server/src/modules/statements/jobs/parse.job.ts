// Задача statements.parse (STMT-04, NFR-21): разбор выписки и предпросмотр в worker — чтение в песочнице, колонки, модель,
// курсы, дубли. В нагрузке — только id импорта; scope приходит в конверте. Ошибка разбора — состояние черновика
// («не получилось прочитать»), а не повтор задачи: тот же файл не прочтётся с другой попытки.
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineJob } from "../../../platform/jobs/define-job.ts";

export function parseJob(run: (s: ScopedDb, importId: string) => Promise<void>) {
  return defineJob({
    name: "statements.parse",
    payload: z.object({ importId: z.uuid() }),
    options: { retryLimit: 0, priority: 10 },
    handle: (ctx, payload) => run(ctx.s, payload.importId),
  });
}
