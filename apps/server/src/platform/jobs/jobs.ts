// Очередь задач процесса (ADR-0008, ARCHITECTURE §3, §4.4, §5): порт Jobs и его реализация на pg-boss. Постановка
// — в транзакции данных (`enqueue(tx, …)` через fromDrizzle на соединении tx: откат — задачи нет). Выполнение —
// только в worker: конверт → перепроверка владельца (ScopeVerifier) → makeScope → ctx.s → обработчик → строка в
// журнале background_job_run. Повтор — только для retryable-ошибок каталога (AppError); остальное и отброшенное —
// сразу в конечное состояние (deadletter без очереди мёртвых писем = failed без повторов).
import { randomUUID } from "node:crypto";
import { isRetryable } from "@kosht/contract";
import { makeScope, type Clock, type HouseholdId, type TimeZone } from "@kosht/kernel";
import { fromDrizzle, type Db, type Job, type JobResult, type PgBoss } from "pg-boss";
import { bossDb, bossTransaction } from "../db/boss-db.ts";
import { createScopedDb, type ScopedDb } from "../db/scoped-db.ts";
import { createSystemDb, type SystemDb } from "../db/system-db.ts";
import { AppError } from "../errors/app-error.ts";
import { currentLogContext, withLogContext } from "../logging/context.ts";
import type { Logger } from "../logging/logger.ts";
import { createBoss, stopBoss, type BossRole } from "./boss.ts";
import { JobEnvelope, queuePolicy, type JobDef } from "./define-job.ts";
import {
  finishRun,
  lastRunOf,
  recentFailures,
  recordDropped,
  runningRuns,
  setProgress,
  startRun,
  type RunView,
} from "./jobs.repo.ts";
import { runSchedule, type ScheduleDef, type ScheduleOutcome } from "./schedule.ts";
import type { ScopeVerifierRegistry } from "./scope-verifier.ts";
import { runSweep, type SweepDef } from "./sweep.ts";

/** Порт очереди (ARCHITECTURE §4.4): в тестах сценариев — InlineJobs из @kosht/testing. */
export interface Jobs {
  /** Поставить задачу владельцу tx в той же транзакции: откат — задачи нет, коммит — задача есть. */
  enqueue<P>(tx: ScopedDb, job: JobDef<P>, payload: P): Promise<void>;
  /**
   * Удалить ещё не начатые задачи домохозяйства во всех очередях процесса (удаление аккаунта, PRIV-06); возвращает,
   * сколько удалено. Уже выполняемую задачу доведёт или отбросит перепроверка владельца (ScopeVerifier).
   */
  discardHousehold(householdId: HouseholdId): Promise<number>;
  /**
   * Обзор для экрана «Система» (ADM-60, OBS-07): что выполняется, последние ошибки и расписания процесса с последним
   * запуском. Только журнал запусков — ни владельцев, ни нагрузок задач.
   */
  overview(): Promise<JobsOverview>;
}

/** Обзор фоновых задач: до OVERVIEW_LIMIT строк в каждом списке. */
export interface JobsOverview {
  readonly running: readonly RunView[];
  readonly failures: readonly RunView[];
  readonly schedules: readonly {
    readonly name: string;
    readonly cron: string;
    readonly lastRun: RunView | null;
  }[];
}

/** Сколько строк в списках обзора. */
export const OVERVIEW_LIMIT = 20;

/** Пул роли приложения: тот же, что принимает bossDb (pg напрямую сюда не импортируется). */
export type JobsPool = Parameters<typeof bossDb>[0];

export interface JobsDeps {
  readonly pool: JobsPool;
  readonly role: BossRole;
  readonly log: Logger;
  readonly clock: Clock;
  readonly scopes: ScopeVerifierRegistry;
  /**
   * Пояс расписаний — настройка clock.time-zone (NFR-23); worker читает её при старте, поэтому смена пояса
   * действует после перезапуска worker.
   */
  timeZone(): Promise<TimeZone>;
  /** Как часто worker спрашивает новые задачи, с (по умолчанию 2; тесты — 0.5). */
  readonly pollingIntervalSeconds?: number;
}

/** Что раскладывает по очередям корень композиции (реестры модулей — T-007). */
export interface JobsRegistry {
  readonly jobs: readonly JobDef[];
  readonly schedules?: readonly ScheduleDef[];
  /** Задача обхода регистрируется вместе с ним, если её нет в jobs. */
  readonly sweeps?: readonly SweepDef[];
}

export interface JobsRuntime extends Jobs {
  /** Создать очереди (все роли — ставить можно сразу) и, в worker, начать обработку и расписания. */
  start(registry: JobsRegistry): Promise<void>;
  /** Новые задачи не берутся, обработчики в полёте доводятся (≤ 8 с); пул остаётся вызывающему. */
  stop(): Promise<void>;
}

const DEFAULT_POLLING_SECONDS = 2;
/** Сколько задач удалять за раз при удалении аккаунта. */
const DISCARD_BATCH = 1000;

export function createJobs(deps: JobsDeps): JobsRuntime {
  const { pool, role, log, clock, scopes } = deps;
  const system = createSystemDb(pool);
  const queues = new Map<string, JobDef>();
  /** Расписания и обходы процесса — имена и cron, для обзора (во всех ролях). */
  let timed: readonly { readonly name: string; readonly cron: string }[] = [];
  let boss: PgBoss | undefined;

  async function send(
    scope: ScopedDb["scope"],
    job: JobDef<unknown>,
    payload: unknown,
    db?: Db,
  ): Promise<void> {
    if (boss === undefined) throw new Error("Очередь задач не запущена: сначала jobs.start().");
    if (queues.get(job.name) !== job) {
      throw new Error(`Задача ${job.name} не зарегистрирована в очереди этого процесса.`);
    }
    const parsed = job.payload.safeParse(payload);
    // Нагрузку собирает код, а не пользователь: несовпадение со схемой — ошибка программы (без значений, OBS-04).
    if (!parsed.success) throw new Error(`Нагрузка задачи ${job.name} не по схеме.`);
    const singletonKey = job.options.singletonKey?.(parsed.data, scope);
    if (singletonKey !== undefined && !singletonKey.startsWith(`${scope.householdId}:`)) {
      throw new Error(
        `singletonKey задачи ${job.name} — только jobKey(scope, …): ключ без домохозяйства подавит чужие задачи.`,
      );
    }
    const envelope: JobEnvelope = {
      scope: { userId: scope.userId, householdId: scope.householdId },
      requestId: currentLogContext().requestId ?? randomUUID(),
      payload: parsed.data,
    };
    await boss.send(job.name, envelope, {
      ...(db === undefined ? {} : { db }),
      ...(job.options.priority === undefined ? {} : { priority: job.options.priority }),
      ...(job.options.startAfterSeconds === undefined
        ? {}
        : { startAfter: job.options.startAfterSeconds }),
      ...(singletonKey === undefined ? {} : { singletonKey }),
    });
  }

  return {
    async enqueue(tx, job, payload) {
      const { tx: db, sql } = bossTransaction(tx);
      await send(tx.scope, job as JobDef<unknown>, payload, fromDrizzle(db, sql));
    },

    async discardHousehold(householdId) {
      if (boss === undefined) throw new Error("Очередь задач не запущена: сначала jobs.start().");
      let discarded = 0;
      // Публичный API pg-boss (findJobs + deleteJob), а не DELETE в его таблицах: у очереди свои счётчики.
      for (const name of queues.keys()) {
        for (;;) {
          const found = await boss.findJobs(name, {
            data: { scope: { householdId } },
            queued: true,
            limit: DISCARD_BATCH,
          });
          if (found.length === 0) break;
          await boss.deleteJob(
            name,
            found.map((job) => job.id),
          );
          discarded += found.length;
        }
      }
      log.info({ householdId, count: discarded }, "jobs.household-discarded");
      return discarded;
    },

    async overview() {
      return {
        running: await runningRuns(system, OVERVIEW_LIMIT),
        failures: await recentFailures(system, OVERVIEW_LIMIT),
        schedules: await Promise.all(
          timed.map(async (timer) => ({
            ...timer,
            lastRun: (await lastRunOf(system, timer.name)) ?? null,
          })),
        ),
      };
    },

    async start(registry) {
      if (boss !== undefined) throw new Error("Очередь задач уже запущена.");
      const timers = [...(registry.schedules ?? []), ...(registry.sweeps ?? [])];
      timed = timers.map((timer) => ({ name: timer.name, cron: timer.cron }));
      const sweepJobs = (registry.sweeps ?? []).map((sweep) => sweep.job);
      for (const job of [...registry.jobs, ...sweepJobs]) {
        const known = queues.get(job.name);
        if (known === job) continue;
        if (known !== undefined || timers.some((timer) => timer.name === job.name)) {
          throw new Error(`Очередь ${job.name} объявлена дважды.`);
        }
        queues.set(job.name, job);
      }
      const instance = createBoss(bossDb(pool), role);
      // Ошибки обслуживания и опроса pg-boss — в лог со стеком; текст предупреждений — нет (только вид).
      instance.on("error", (error) => log.error({ err: error }, "jobs.error"));
      instance.on("warning", (warning) =>
        log.warn({ reason: warningType(warning.data) }, "jobs.warning"),
      );
      await instance.start();
      boss = instance;
      for (const job of queues.values()) {
        await instance.createQueue(job.name, {
          policy: queuePolicy(job),
          retryLimit: job.options.retryLimit ?? 2,
          retryDelay: job.options.retryDelaySeconds ?? 0,
          ...(job.options.expireInSeconds === undefined
            ? {}
            : { expireInSeconds: job.options.expireInSeconds }),
        });
      }
      if (role === "worker") {
        const work = {
          pollingIntervalSeconds: deps.pollingIntervalSeconds ?? DEFAULT_POLLING_SECONDS,
          perJobResults: true,
        } as const;
        for (const job of queues.values()) {
          // У срочной для человека задачи — своя частота опроса поверх общей (JobOptions.pollingIntervalSeconds).
          const jobWork =
            job.options.pollingIntervalSeconds === undefined
              ? work
              : { ...work, pollingIntervalSeconds: job.options.pollingIntervalSeconds };
          await instance.work(job.name, jobWork, async (batch) =>
            Promise.all(
              batch.map((item) => runJob({ pool, system, log, clock, scopes }, job, item)),
            ),
          );
        }
        // Расписание и обход — очередь short: пока один тик ждёт, следующий не копится.
        const timeZone = await deps.timeZone();
        const ticks: Tick[] = [
          ...(registry.schedules ?? []).map((schedule) => ({
            name: schedule.name,
            cron: schedule.cron,
            run: async (item: Job<unknown>) =>
              SCHEDULE_STATUS[
                await runSchedule(
                  schedule,
                  { system, clock, log },
                  { requestId: item.id, log, signal: item.signal },
                )
              ],
          })),
          ...(registry.sweeps ?? []).map((sweep) => ({
            name: sweep.name,
            cron: sweep.cron,
            run: async () => {
              try {
                await runSweep(sweep, {
                  pool,
                  system,
                  clock,
                  log,
                  enqueue: (scope, job, payload) => send(scope, job, payload),
                });
                return "completed" as const;
              } catch (error) {
                log.error({ err: error, job: sweep.name }, "jobs.sweep-failed");
                return failureStatus(error);
              }
            },
          })),
        ];
        for (const tick of ticks) {
          await instance.createQueue(tick.name, { policy: "short", retryLimit: 2 });
          await instance.work(tick.name, work, async (batch) =>
            Promise.all(
              batch.map(async (item) => ({
                id: item.id,
                status: await withLogContext({ requestId: item.id, source: "job" }, () =>
                  tick.run(item),
                ),
              })),
            ),
          );
          await instance.schedule(tick.name, tick.cron, null, { tz: timeZone, missed: "once" });
        }
      }
      log.info({ role, count: queues.size + timers.length }, "jobs.started");
    },

    async stop() {
      if (boss === undefined) return;
      await stopBoss(boss);
      boss = undefined;
    },
  };
}

/** Очередь по cron: расписание платформы или обход; requestId прогона — id задачи pg-boss (ищется в логе). */
interface Tick {
  readonly name: string;
  readonly cron: string;
  run(item: Job<unknown>): Promise<JobResult["status"]>;
}

/** Итог прогона расписания → итог задачи pg-boss: retry — повторить, failed — без повторов. */
const SCHEDULE_STATUS = {
  idle: "completed",
  completed: "completed",
  retry: "failed",
  failed: "deadletter",
} as const satisfies Record<ScheduleOutcome, JobResult["status"]>;

/** Ошибка → итог для pg-boss: повтор (failed) только для retryable-кода каталога, иначе deadletter без повторов. */
function failureStatus(error: unknown): "failed" | "deadletter" {
  return error instanceof AppError && isRetryable(error.code) ? "failed" : "deadletter";
}

/** Вид предупреждения pg-boss (`queue_backlog`, `slow_query`…): текст и прочие поля в лог не идут. */
function warningType(data: object): string {
  const type: unknown = Reflect.get(data, "type");
  return typeof type === "string" ? type : "unknown";
}

interface RunDeps {
  readonly pool: JobsPool;
  readonly system: SystemDb;
  readonly log: Logger;
  readonly clock: Clock;
  readonly scopes: ScopeVerifierRegistry;
}

/** Выполнить одну задачу: итог для pg-boss — completed, failed (повторить) или deadletter (не повторять). */
async function runJob(deps: RunDeps, job: JobDef, item: Job<unknown>): Promise<JobResult> {
  const { system, log, clock } = deps;
  const startedAt = clock.now();
  const done = (status: JobResult["status"]): JobResult => ({ id: item.id, status });
  const envelope = JobEnvelope.safeParse(item.data);
  if (!envelope.success) {
    log.error({ job: job.name, jobId: item.id }, "jobs.envelope-invalid");
    await recordDropped(system, { kind: job.name, startedAt, errorCode: "VALIDATION" });
    return done("deadletter");
  }
  const { scope: candidate, requestId } = envelope.data;
  return withLogContext({ requestId, uid: candidate.userId, source: "job" }, async () => {
    // ARCHITECTURE §6.4: scope из конверта — только после проверки «пользователь есть, домохозяйство то же».
    if (!(await deps.scopes.verify(candidate))) {
      log.warn({ job: job.name, jobId: item.id }, "jobs.scope-rejected");
      await recordDropped(system, { kind: job.name, startedAt, errorCode: "FORBIDDEN" });
      return done("deadletter");
    }
    const payload = job.payload.safeParse(envelope.data.payload);
    if (!payload.success) {
      log.error({ job: job.name, jobId: item.id }, "jobs.payload-invalid");
      await recordDropped(system, { kind: job.name, startedAt, errorCode: "VALIDATION" });
      return done("deadletter");
    }
    const s = createScopedDb(deps.pool, makeScope(candidate));
    const runId = await startRun(system, { kind: job.name, startedAt });
    try {
      await job.handle(
        {
          s,
          requestId,
          log,
          signal: item.signal,
          progress: (percent) => setProgress(system, runId, percent),
        },
        payload.data,
      );
    } catch (error) {
      const code = error instanceof AppError ? error.code : "INTERNAL";
      log.error({ err: error, job: job.name, jobId: item.id, code }, "jobs.failed");
      await finishRun(system, runId, {
        status: "failed",
        finishedAt: clock.now(),
        errorCode: code,
      });
      return done(failureStatus(error));
    }
    await finishRun(system, runId, { status: "completed", finishedAt: clock.now() });
    log.info(
      { job: job.name, jobId: item.id, ms: clock.now().getTime() - startedAt.getTime() },
      "jobs.completed",
    );
    return done("completed");
  });
}
