// Трассы Langfuse удаляются вместе с аккаунтом (PRIV-06, OBS-05): llm — владелец трасс, его хук afterDelete в реестре
// владельцев данных зовёт privacy при удалении аккаунта. Langfuse недоступен (или выключен) — пользователь встаёт в
// очередь повторов (llm_trace_deletions, без scope), а удаление аккаунта идёт дальше; ежедневное расписание
// повторяет очередь, пока Langfuse не ответит. Ошибка Langfuse здесь — не ошибка удаления аккаунта.
import type { Scope } from "@kosht/kernel";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { defineSchedule } from "../../../platform/jobs/schedule.ts";
import {
  completeTraceDeletion,
  failTraceDeletion,
  pendingTraceDeletions,
  queueTraceDeletion,
} from "../infrastructure/db/trace-deletions.repo.ts";
import type { TraceDeleter } from "./ports.ts";

/** Сколько пользователей из очереди повторов обрабатывать за один прогон. */
export const RETRY_BATCH = 100;

export function makeTraceDeletion(d: {
  readonly platform: Pick<SystemPlatform, "system" | "clock" | "log">;
  /** Нет — Langfuse выключен: удалять негде, пользователь ждёт в очереди. */
  readonly deleter: TraceDeleter | undefined;
}) {
  const { platform } = d;

  /** Удалить трассы пользователя сейчас; не вышло — в очередь повторов. Не бросает. */
  async function deleteUserTraces(scope: Scope): Promise<void> {
    const { userId } = scope;
    if (d.deleter !== undefined && (await attempt(d.deleter, userId))) return;
    await queueTraceDeletion(platform.system, userId, platform.clock.now());
    platform.log.warn({ userId }, "llm.trace-deletion-queued");
  }

  async function attempt(deleter: TraceDeleter, userId: string): Promise<boolean> {
    try {
      const count = await deleter.deleteUserTraces(userId);
      platform.log.info({ userId, count }, "llm.traces-deleted");
      return true;
    } catch (error) {
      platform.log.warn({ userId, err: error }, "llm.trace-deletion-failed");
      return false;
    }
  }

  /** Прогон очереди повторов: удалённые уходят из очереди, неудачные ждут следующего дня. */
  async function retryQueued(): Promise<void> {
    if (d.deleter === undefined) return;
    for (const userId of await pendingTraceDeletions(platform.system, RETRY_BATCH)) {
      if (await attempt(d.deleter, userId)) {
        await completeTraceDeletion(platform.system, userId);
      } else {
        await failTraceDeletion(platform.system, userId, platform.clock.now());
      }
    }
  }

  /** Ежедневный повтор очереди (03:40 по поясу системы). */
  const retrySchedule = defineSchedule({
    name: "llm.trace-deletions",
    cron: "40 3 * * *",
    stepDays: 1,
    handle: async () => retryQueued(),
  });

  return { deleteUserTraces, retryQueued, retrySchedule };
}

export type TraceDeletion = ReturnType<typeof makeTraceDeletion>;
