// Задача transactions.fill-rates (STMT-09): досчитать эквивалент в BYN для операций в валюте, пока курса НБРБ не было.
// В нагрузке — только id операций; чьи данные — scope конверта. UNAVAILABLE повторяемая: пока НБРБ молчит, очередь
// пробует снова с паузой (операция всё это время показывается «курс не получен»). Без singletonKey: он бы схлопнул
// задачи разных операций и потерял бы их id.
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineJob } from "../../../platform/jobs/define-job.ts";

export function fillRatesJob(run: (s: ScopedDb, ids: readonly string[]) => Promise<void>) {
  return defineJob({
    name: "transactions.fill-rates",
    payload: z.object({ ids: z.array(z.uuid()).min(1).max(1000) }),
    options: {
      retryLimit: 6,
      retryDelaySeconds: 600,
      startAfterSeconds: 30,
    },
    handle: (ctx, payload) => run(ctx.s, payload.ids),
  });
}
