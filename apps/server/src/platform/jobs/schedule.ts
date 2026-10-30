// Расписание платформы (NFR-22, ADR-0008): cron по поясу системы с missed: "once" (jobs.ts) + водяной знак в
// background_job_run. После простоя pg-boss присылает один запуск, а обработчик получает все закончившиеся с
// водяного знака периоды; водяной знак двигается только после успешного прогона. Расписания «для каждого
// пользователя» — defineSweep (sweep.ts), их водяные знаки — в таблицах модулей.
import { isRetryable } from "@kosht/contract";
import type { Clock, Period } from "@kosht/kernel";
import type { SystemDb } from "../db/system-db.ts";
import { AppError } from "../errors/app-error.ts";
import type { Logger } from "../logging/logger.ts";
import { JOB_NAME } from "./define-job.ts";
import { finishRun, lastWatermark, startRun } from "./jobs.repo.ts";
import { pendingPeriods } from "./periods.ts";

export interface ScheduleContext {
  readonly requestId: string;
  readonly log: Logger;
  readonly signal: AbortSignal;
}

export interface ScheduleDef {
  /** Имя очереди и ключ водяного знака: `<модуль>.<что>`. */
  readonly name: string;
  /** cron по поясу настройки clock.time-zone (NFR-23); у расписания с `liveCron` — запасной, если настройка не читается. */
  readonly cron: string;
  /**
   * cron из настройки, которую администратор меняет без перезапуска (T-039: время ежедневной проверки законов). Worker
   * сверяет его с зарегистрированным раз в `rescheduleEveryMs` и при смене перерегистрирует расписание в pg-boss.
   */
  readonly liveCron?: () => Promise<string>;
  /** Длина периода в днях: 1 — сутки, 7 — неделя. */
  readonly stepDays: number;
  /** Обработать закончившиеся периоды по порядку; идемпотентен (упавший прогон повторится с теми же). */
  handle(ctx: ScheduleContext, periods: readonly Period[]): Promise<void>;
}

export function defineSchedule(definition: ScheduleDef): ScheduleDef {
  if (!JOB_NAME.test(definition.name)) {
    throw new RangeError(
      `Имя расписания «${definition.name}»: ожидается <модуль>.<что> строчными.`,
    );
  }
  if (definition.cron.trim() === "")
    throw new RangeError(`Расписание ${definition.name}: пустой cron.`);
  if (!Number.isInteger(definition.stepDays) || definition.stepDays < 1) {
    throw new RangeError(`Расписание ${definition.name}: stepDays — целое число дней ≥ 1.`);
  }
  return definition;
}

export interface ScheduleRunDeps {
  readonly system: SystemDb;
  readonly clock: Clock;
  readonly log: Logger;
}

/** Итог прогона: нечего догонять, прошёл, упал с повтором (retryable) или без. */
export type ScheduleOutcome = "idle" | "completed" | "retry" | "failed";

/** Один прогон расписания: водяной знак → закончившиеся периоды → обработчик → новый водяной знак. */
export async function runSchedule(
  schedule: ScheduleDef,
  deps: ScheduleRunDeps,
  ctx: ScheduleContext,
): Promise<ScheduleOutcome> {
  const { system, clock, log } = deps;
  const watermark = await lastWatermark(system, schedule.name);
  const periods = pendingPeriods(watermark, clock.today(), schedule.stepDays);
  const last = periods.at(-1);
  if (last === undefined) return "idle";
  const runId = await startRun(system, {
    kind: schedule.name,
    scheduleKey: schedule.name,
    startedAt: clock.now(),
  });
  try {
    await schedule.handle(ctx, periods);
  } catch (error) {
    const code = error instanceof AppError ? error.code : "INTERNAL";
    log.error({ err: error, job: schedule.name, code }, "jobs.schedule-failed");
    await finishRun(system, runId, { status: "failed", finishedAt: clock.now(), errorCode: code });
    return error instanceof AppError && isRetryable(error.code) ? "retry" : "failed";
  }
  await finishRun(system, runId, {
    status: "completed",
    finishedAt: clock.now(),
    watermark: last.to,
  });
  log.info({ job: schedule.name, count: periods.length }, "jobs.schedule-completed");
  return "completed";
}
