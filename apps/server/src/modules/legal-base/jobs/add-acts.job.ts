// Задача legal-base.add-acts (LAW-16, LAW-40): добавить акты, названные администратором, — «по ссылке», «списком» или кнопкой
// «Добавить» в очереди кандидатов. Выполняет worker (единственная очередь запросов к pravo.by, LAW-35), владелец конверта —
// вошедший администратор; в нагрузке только ID актов. Векторы новых актов достраивает следом `legal-base.embed`.
import { z } from "zod";
import { defineJob } from "../../../platform/jobs/define-job.ts";
import type { AddActs } from "../application/add-acts.ts";
import { PRAVO_ID } from "../domain/act-links.ts";

const RUN_SECONDS = 3 * 3600;

export function addActsJob(
  run: AddActs,
  afterRun: (s: Parameters<Parameters<typeof defineJob>[0]["handle"]>[0]["s"]) => Promise<void>,
) {
  return defineJob({
    name: "legal-base.add-acts",
    payload: z.object({ pravoIds: z.array(z.string().regex(PRAVO_ID)).min(1).max(200) }),
    // Повтор — только при остановке загрузчика (повторяемая ошибка): раз в 30 минут, пока не пройдёт.
    options: { retryLimit: 4, retryDelaySeconds: 1800, expireInSeconds: RUN_SECONDS },
    handle: async (ctx, payload) => {
      try {
        await run(payload.pravoIds, ctx.signal);
      } finally {
        await afterRun(ctx.s);
      }
    },
  });
}
