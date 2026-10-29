// Задача llm.download-models (NFR-25): скачать локальные модели в worker — по гигабайтам, с докачкой. Владелец конверта —
// администратор, запустивший скачивание (первый запуск или кнопка в админке), но данных домохозяйства задача не трогает:
// состояние пишется в системную таблицу, прогресс читает api. Сеть и 5xx — retryable: задача повторяется с паузой и
// продолжает с места обрыва; нехватка места и неверная сумма повторами не лечатся.
import { z } from "zod";
import { defineJob } from "../../../platform/jobs/define-job.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";
import type { LocalModels } from "../application/local-models/local-models.ts";

/** Сколько может работать загрузка: 6 ГиБ на медленном канале — часы. */
const DOWNLOAD_SECONDS = 6 * 3600;

export function downloadModelsJob(
  download: LocalModels["download"],
  publishReady: (
    s: Parameters<Parameters<typeof defineJob>[0]["handle"]>[0]["s"],
    ids: readonly string[],
  ) => Promise<void>,
) {
  return defineJob({
    name: "llm.download-models",
    payload: z.object({}),
    options: {
      retryLimit: 5,
      retryDelaySeconds: 30,
      expireInSeconds: DOWNLOAD_SECONDS,
      // Повторное нажатие кнопки, пока задача ждёт очереди, не ставит вторую.
      singletonKey: (_payload, scope) => jobKey(scope, "download-models"),
    },
    handle: (ctx) =>
      download({
        signal: ctx.signal,
        progress: (percent) => ctx.progress(percent),
        ready: (ids) => publishReady(ctx.s, ids),
      }),
  });
}
