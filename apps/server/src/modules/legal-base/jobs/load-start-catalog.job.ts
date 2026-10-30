// Задача legal-base.load-start-catalog (LAW-10): загрузить стартовый каталог в worker — единственная очередь запросов к
// pravo.by (LAW-35: один поток; `localConcurrency` pg-boss по умолчанию 1, пауза — в БД, advisory-lock). Владелец конверта —
// администратор первого запуска, но данных домохозяйства задача не трогает: пишет в таблицы legal-base. Остановка загрузчика
// и ошибки актов — повторяемая ошибка: повтор через 30 минут (до двух суток), пока не загружено всё.
import { z } from "zod";
import { defineJob } from "../../../platform/jobs/define-job.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";
import type { StartCatalog } from "../application/start-catalog.ts";

/** Сколько может работать один запуск: 28 страниц по 3–5 с плюс лесенка повторов — с запасом 6 часов. */
const RUN_SECONDS = 6 * 3600;

export function loadStartCatalogJob(catalog: Pick<StartCatalog, "run">) {
  return defineJob({
    name: "legal-base.load-start-catalog",
    payload: z.object({}),
    options: {
      retryLimit: 96,
      retryDelaySeconds: 1800,
      expireInSeconds: RUN_SECONDS,
      // Повторная доставка события первого запуска не ставит вторую задачу, пока первая ждёт очереди.
      singletonKey: (_payload, scope) => jobKey(scope, "load-start-catalog"),
    },
    handle: (ctx) =>
      catalog.run({ signal: ctx.signal, progress: (percent) => ctx.progress(percent) }),
  });
}
