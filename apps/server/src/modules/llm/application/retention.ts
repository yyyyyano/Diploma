// Ночные задачи хранения (LLM-06, OBS-05): журнал расхода — 90 дней, трассы Langfuse — 30 дней; сроки — настройки.
// Журнал чистится пачками по 1000 строк (долгой блокировки таблицы нет); трассы — через TraceDeleter (пачки ≤ 1000
// внутри него). Langfuse выключен — трасс нет, чистить нечего. Ошибка Langfuse — ошибка прогона: расписание повторит.
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { defineSchedule } from "../../../platform/jobs/schedule.ts";
import { deleteUsageBefore } from "../infrastructure/db/llm.repo.ts";
import { LLM_TRACE_RETENTION_DAYS, LLM_USAGE_RETENTION_DAYS } from "../settings.ts";
import type { TraceDeleter } from "./ports.ts";

const DAY_MS = 86_400_000;
/** Строк журнала за один запрос удаления. */
export const USAGE_BATCH = 1000;

export function makeRetention(d: {
  readonly platform: Pick<SystemPlatform, "system" | "clock" | "settings" | "log">;
  /** Нет — Langfuse выключен: трасс нет. */
  readonly deleter: TraceDeleter | undefined;
}) {
  const { platform } = d;

  /** Удалить строки журнала старше срока; сколько удалено. */
  async function purgeUsage(): Promise<number> {
    const days = await platform.settings.get(LLM_USAGE_RETENTION_DAYS);
    const before = new Date(platform.clock.now().getTime() - days * DAY_MS);
    let total = 0;
    for (;;) {
      const batch = await deleteUsageBefore(platform.system, before, USAGE_BATCH);
      total += batch;
      if (batch < USAGE_BATCH) break;
    }
    platform.log.info({ count: total }, "llm.usage-purged");
    return total;
  }

  /** Отправить на удаление трассы старше срока; сколько отправлено. */
  async function purgeTraces(): Promise<number> {
    if (d.deleter === undefined) return 0;
    const days = await platform.settings.get(LLM_TRACE_RETENTION_DAYS);
    const before = new Date(platform.clock.now().getTime() - days * DAY_MS);
    const count = await d.deleter.deleteTracesBefore(before);
    platform.log.info({ count }, "llm.traces-purged");
    return count;
  }

  return {
    purgeUsage,
    purgeTraces,
    usageSchedule: defineSchedule({
      name: "llm.usage-retention",
      cron: "20 3 * * *",
      stepDays: 1,
      handle: async () => void (await purgeUsage()),
    }),
    traceSchedule: defineSchedule({
      name: "llm.trace-retention",
      cron: "30 3 * * *",
      stepDays: 1,
      handle: async () => void (await purgeTraces()),
    }),
  };
}

export type Retention = ReturnType<typeof makeRetention>;
