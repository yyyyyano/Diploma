// Задача legal-base.embed (LAW-22, LAW-23): векторы действующих версий без вектора активной модели — в worker, порциями,
// с прогрессом. Нет модели — задача завершается («ждём модель»), а не повторяется по кругу; её ставят после загрузки
// актов и ежедневная проверка (T-036).
import { z } from "zod";
import { defineJob } from "../../../platform/jobs/define-job.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";
import type { Embedder } from "../application/embed.ts";

const RUN_SECONDS = 6 * 3600;

export function embedJob(embedder: Pick<Embedder, "run">) {
  return defineJob({
    name: "legal-base.embed",
    payload: z.object({}),
    options: {
      retryLimit: 1,
      expireInSeconds: RUN_SECONDS,
      singletonKey: (_payload, scope) => jobKey(scope, "embed"),
    },
    handle: async (ctx) => {
      await embedder.run({ signal: ctx.signal, progress: (percent) => ctx.progress(percent) });
    },
  });
}
