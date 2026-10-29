// identity.system-initialized → скачивание локальных моделей (AUTH-10, NFR-25): после первого запуска система сама
// ставит задачу llm.download-models; прогресс виден на экране первого запуска и в админке. Повторная доставка события
// не ставит вторую задачу (ключ схлопывания в самой задаче).
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { systemInitialized } from "../../identity/index.ts";
import type { downloadModelsJob } from "../jobs/download-models.job.ts";

export function onSystemInitialized(
  platform: Pick<Platform, "jobs">,
  job: ReturnType<typeof downloadModelsJob>,
) {
  return defineSubscription({
    event: systemInitialized,
    module: "llm",
    handle: async (ctx) => {
      await ctx.s.transaction((tx) => platform.jobs.enqueue(tx, job, {}));
    },
  });
}
