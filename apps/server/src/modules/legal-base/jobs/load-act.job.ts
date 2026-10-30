// Задача legal-base.load-act (LAW-09): загрузить один акт по требованию — с приоритетом выше фоновой загрузки каталога. Ставит её
// `api` (вопрос назвал акт без индекса), выполняет worker: единственная очередь запросов к pravo.by (LAW-35).
import { z } from "zod";
import { defineJob } from "../../../platform/jobs/define-job.ts";
import { jobKey } from "../../../platform/jobs/job-key.ts";
import type { LoadAct } from "../application/load-act.ts";

export function loadActJob(
  loadAct: LoadAct,
  afterLoad: (s: Parameters<Parameters<typeof defineJob>[0]["handle"]>[0]["s"]) => Promise<void>,
) {
  return defineJob({
    name: "legal-base.load-act",
    payload: z.object({ pravoId: z.string().regex(/^[A-Za-z][A-Za-z0-9]{5,11}$/u) }),
    options: {
      priority: 20,
      retryLimit: 1,
      pollingIntervalSeconds: 0.5,
      singletonKey: (payload, scope) => jobKey(scope, `load-act:${payload.pravoId}`),
    },
    handle: async (ctx, payload) => {
      await loadAct(payload.pravoId, ctx.signal);
      // Векторы достраиваются в фоне: поиск по реквизитам и FTS работает сразу после разбора (LAW-22).
      await afterLoad(ctx.s);
    },
  });
}
