// Задача legal-base.check-now (LAW-40): «Проверить сейчас» (весь проход — проверка актов и пополнение каталога, как ночью) и
// «Проверить, появился ли текст» у одного акта-карточки. Ставит администратор, выполняет worker: запросы к pravo.by — только
// оттуда (LAW-35). Ручной запуск не повторяется сам; те же кнопки, пока запуск ждёт очереди, не плодят задачи.
import { z } from "zod";
import { AppError } from "../../../platform/errors/app-error.ts";
import { defineJob } from "../../../platform/jobs/define-job.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";
import type { CatalogGrowth } from "../application/catalog-growth.ts";
import type { DailyCheck } from "../application/daily-check.ts";
import { LoaderStopped } from "../application/ports.ts";
import { PRAVO_ID } from "../domain/act-links.ts";

const RUN_SECONDS = 6 * 3600;

export function checkNowJob(
  d: {
    readonly dailyCheck: DailyCheck;
    readonly growth: Pick<CatalogGrowth, "run" | "checkTextNow">;
  },
  afterRun: (s: Parameters<Parameters<typeof defineJob>[0]["handle"]>[0]["s"]) => Promise<void>,
) {
  return defineJob({
    name: "legal-base.check-now",
    payload: z.object({ pravoId: z.string().regex(PRAVO_ID).nullable() }),
    options: {
      retryLimit: 0,
      expireInSeconds: RUN_SECONDS,
      singletonKey: (payload, scope) => jobKey(scope, `check-now:${payload.pravoId ?? "all"}`),
    },
    handle: async (ctx, payload) => {
      try {
        if (payload.pravoId === null) {
          await d.dailyCheck(ctx.signal);
          await d.growth.run();
        } else {
          await d.growth.checkTextNow(payload.pravoId);
        }
      } catch (error) {
        // Остановка загрузчика у одного акта — тот же класс ошибки, что у проходов: администратору её покажет вкладка.
        if (error instanceof LoaderStopped) throw new AppError("UNAVAILABLE");
        throw error;
      } finally {
        await afterRun(ctx.s);
      }
    },
  });
}
