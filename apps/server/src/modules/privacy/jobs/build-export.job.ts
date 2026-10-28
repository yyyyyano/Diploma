// Задача privacy.build-export (PRIV-05): собрать архив «Мои данные» в worker — тяжёлое не в обработчике HTTP. В
// нагрузке — только id заявки; чьи данные — scope конверта (ctx.s). Повторов нет: сборка, упавшая не по сети, при
// повторе упадёт так же, а заявка уже помечена «не удалось» — человек повторит её сам.
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineJob } from "../../../platform/jobs/define-job.ts";
import { EXPORT_BUILD_SECONDS } from "../application/data-export.ts";

export function buildExportJob(build: (s: ScopedDb, exportId: string) => Promise<void>) {
  return defineJob({
    name: "privacy.build-export",
    payload: z.object({ exportId: z.uuid() }),
    options: { retryLimit: 0, expireInSeconds: EXPORT_BUILD_SECONDS },
    handle: (ctx, payload) => build(ctx.s, payload.exportId),
  });
}
