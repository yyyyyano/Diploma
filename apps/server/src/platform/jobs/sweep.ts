// «Для всех пользователей» (ARCHITECTURE §6.6, ADR-0006, ADR-0008): по расписанию сквозной запрос crossTenant
// находит владельцев строк, которым нужна работа (тик напоминаний, итоги недели, зависшие чеки), — только
// (id, householdId, userId), — и ставит каждому задачу под его scope. Данные читает уже задача, через свой ctx.s.
import { HouseholdId, makeScope, UserId, type Clock, type Scope } from "@kosht/kernel";
import { crossTenant, type OwnerRow } from "../db/cross-tenant.ts";
import type { SystemDb } from "../db/system-db.ts";
import { AppError } from "../errors/app-error.ts";
import type { Logger } from "../logging/logger.ts";
import { JOB_NAME, type JobDef } from "./define-job.ts";
import { finishRun, startRun } from "./jobs.repo.ts";

/** Сквозной запрос: один SELECT, возвращающий только id, household_id, user_id (иначе ISOLATION_VIOLATION). */
export type SweepFind = Parameters<typeof crossTenant>[2];

export interface SweepDef<P = unknown> {
  /** Имя очереди обхода и метка crossTenant в журнале: `<модуль>.<что>`. */
  readonly name: string;
  /** cron по поясу настройки system.time-zone. */
  readonly cron: string;
  readonly find: SweepFind;
  /** Задача, которая ставится каждому найденному владельцу. */
  readonly job: JobDef<P>;
  /** Нагрузка задачи из найденной строки — только id. */
  payload(row: OwnerRow): P;
}

export function defineSweep<P>(definition: SweepDef<P>): SweepDef<P> {
  if (!JOB_NAME.test(definition.name)) {
    throw new RangeError(`Имя обхода «${definition.name}»: ожидается <модуль>.<что> строчными.`);
  }
  if (definition.cron.trim() === "") throw new RangeError(`Обход ${definition.name}: пустой cron.`);
  return definition;
}

export interface SweepRunDeps {
  readonly pool: Parameters<typeof crossTenant>[0];
  readonly system: SystemDb;
  readonly clock: Clock;
  readonly log: Logger;
  /** Поставить задачу владельцу (вне транзакции данных: обход ничего не пишет). */
  enqueue(scope: Scope, job: JobDef<unknown>, payload: unknown): Promise<void>;
}

/** Обход: найти владельцев и поставить задачу каждому; вернуть число поставленных. */
export async function runSweep(sweep: SweepDef, deps: SweepRunDeps): Promise<number> {
  const { system, clock, log } = deps;
  const runId = await startRun(system, { kind: sweep.name, startedAt: clock.now() });
  let rows: readonly OwnerRow[];
  try {
    rows = await crossTenant(deps.pool, sweep.name, sweep.find);
    for (const row of rows) {
      const scope = makeScope({
        userId: UserId.parse(row.userId),
        householdId: HouseholdId.parse(row.householdId),
      });
      await deps.enqueue(scope, sweep.job, sweep.payload(row));
    }
  } catch (error) {
    // Строку журнала закрываем, ошибку — наружу: обход повторит pg-boss, ISOLATION_VIOLATION виден в логе.
    await finishRun(system, runId, {
      status: "failed",
      finishedAt: clock.now(),
      errorCode: error instanceof AppError ? error.code : "INTERNAL",
    });
    throw error;
  }
  await finishRun(system, runId, { status: "completed", finishedAt: clock.now() });
  log.info({ job: sweep.name, count: rows.length }, "jobs.sweep-completed");
  return rows.length;
}
