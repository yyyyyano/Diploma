// Очередь задач процесса (ADR-0008, ARCHITECTURE §3, §4.4, §5): порт Jobs и его реализация на pg-boss. Постановка
// — в транзакции данных (`enqueue(tx, …)` через fromDrizzle на соединении tx: откат — задачи нет). Выполнение —
// только в worker: конверт → перепроверка владельца (ScopeVerifier) → makeScope → ctx.s → обработчик → строка в
// журнале background_job_run. Повтор — только для retryable-ошибок каталога (AppError); остальное и отброшенное —
// сразу в конечное состояние (deadletter без очереди мёртвых писем = failed без повторов).
import { randomUUID } from "node:crypto";
import { isRetryable } from "@kosht/contract";
import { makeScope, type Clock } from "@kosht/kernel";
import { fromDrizzle, type Db, type Job, type JobResult, type PgBoss } from "pg-boss";
import { bossDb, bossTransaction } from "../db/boss-db.ts";
import { createScopedDb, type ScopedDb } from "../db/scoped-db.ts";
import { createSystemDb, type SystemDb } from "../db/system-db.ts";
import { AppError } from "../errors/app-error.ts";
import { currentLogContext, withLogContext } from "../logging/context.ts";
import type { Logger } from "../logging/logger.ts";
import { createBoss, stopBoss, type BossRole } from "./boss.ts";
import { JobEnvelope, queuePolicy, type JobDef } from "./define-job.ts";
import { finishRun, recordDropped, setProgress, startRun } from "./jobs.repo.ts";
import type { ScopeVerifierRegistry } from "./scope-verifier.ts";

/** Порт очереди (ARCHITECTURE §4.4): в тестах сценариев — InlineJobs из @kosht/testing. */
export interface Jobs {
  /** Поставить задачу владельцу tx в той же транзакции: откат — задачи нет, коммит — задача есть. */
  enqueue<P>(tx: ScopedDb, job: JobDef<P>, payload: P): Promise<void>;
}

/** Пул роли приложения: тот же, что принимает bossDb (pg напрямую сюда не импортируется). */
export type JobsPool = Parameters<typeof bossDb>[0];

export interface JobsDeps {
  readonly pool: JobsPool;
  readonly role: BossRole;
  readonly log: Logger;
  readonly clock: Clock;
  readonly scopes: ScopeVerifierRegistry;
  /** Как часто worker спрашивает новые задачи, с (по умолчанию 2; тесты — 0.5). */
  readonly pollingIntervalSeconds?: number;
}

/** Что раскладывает по очередям корень композиции (реестры модулей — T-007). */
export interface JobsRegistry {
  readonly jobs: readonly JobDef[];
}

export interface JobsRuntime extends Jobs {
  /** Создать очереди (все роли — ставить можно сразу) и, в worker, начать обработку. */
  start(registry: JobsRegistry): Promise<void>;
  /** Новые задачи не берутся, обработчики в полёте доводятся (≤ 8 с); пул остаётся вызывающему. */
  stop(): Promise<void>;
}

const DEFAULT_POLLING_SECONDS = 2;

export function createJobs(deps: JobsDeps): JobsRuntime {
  const { pool, role, log, clock, scopes } = deps;
  const system = createSystemDb(pool);
  const queues = new Map<string, JobDef>();
  let boss: PgBoss | undefined;

  async function send(
    scope: ScopedDb["scope"],
    job: JobDef<unknown>,
    payload: unknown,
    db: Db,
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
      db,
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

    async start(registry) {
      if (boss !== undefined) throw new Error("Очередь задач уже запущена.");
      for (const job of registry.jobs) {
        if (queues.has(job.name)) throw new Error(`Задача ${job.name} объявлена дважды.`);
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
      if (role !== "worker") return;
      for (const job of queues.values()) {
        await instance.work(
          job.name,
          {
            pollingIntervalSeconds: deps.pollingIntervalSeconds ?? DEFAULT_POLLING_SECONDS,
            perJobResults: true,
          },
          async (batch) =>
            Promise.all(
              batch.map((item) => runJob({ pool, system, log, clock, scopes }, job, item)),
            ),
        );
      }
      log.info({ role, count: queues.size }, "jobs.started");
    },

    async stop() {
      if (boss === undefined) return;
      await stopBoss(boss);
      boss = undefined;
    },
  };
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
      const retry = error instanceof AppError && isRetryable(error.code);
      log.error({ err: error, job: job.name, jobId: item.id, code }, "jobs.failed");
      await finishRun(system, runId, {
        status: "failed",
        finishedAt: clock.now(),
        errorCode: code,
      });
      return done(retry ? "failed" : "deadletter");
    }
    await finishRun(system, runId, { status: "completed", finishedAt: clock.now() });
    log.info(
      { job: job.name, jobId: item.id, ms: clock.now().getTime() - startedAt.getTime() },
      "jobs.completed",
    );
    return done("completed");
  });
}
