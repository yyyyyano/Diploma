// Очередь задач на настоящем Postgres под ролью приложения kosht_app (ADR-0008, ADR-0020). Ожидание обработки —
// промис, который разрешает сам обработчик (без sleep).
import type { Scope } from "@kosht/kernel";
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { migrateFixtures } from "../db/__fixtures__/fixture-db.ts";
import { fxReceipts } from "../db/__fixtures__/schema.ts";
import { findStuckReceipts } from "../db/__fixtures__/stuck-receipts.ts";
import { bossDb } from "../db/boss-db.ts";
import { createScopedDb } from "../db/scoped-db.ts";
import { AppError } from "../errors/app-error.ts";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import { withLogContext } from "../logging/context.ts";
import { createBoss, stopBoss, type BossRole } from "./boss.ts";
import { defineJob } from "./define-job.ts";
import { defineSchedule } from "./schedule.ts";
import { defineSweep } from "./sweep.ts";
import { installJobsSchema } from "./install.ts";
import { createJobs, type JobsRegistry, type JobsRuntime } from "./jobs.ts";
import { createScopeVerifierRegistry, type ScopeVerifier } from "./scope-verifier.ts";

const scopeA = testScope({ user: 1, household: 1 });

let db: TestDb;
const running: JobsRuntime[] = [];
beforeAll(async () => {
  db = await createTestDb();
  await migrateFixtures(db.owner);
});
afterAll(async () => {
  for (const jobs of running) await jobs.stop();
  await db.drop();
});

/** Очередь процесса роли role на пуле роли приложения; проверка scope — своя у каждого теста. */
async function startJobs(
  role: BossRole,
  registry: JobsRegistry,
  verify: ScopeVerifier,
  timeZone = "Europe/Minsk",
) {
  const scopes = createScopeVerifierRegistry();
  scopes.register(verify);
  const logs = memoryLogger();
  const runtime = createJobs({
    pool: db.pool,
    role,
    log: logs.log,
    clock: new FakeClock("2026-10-21T09:00:00Z"),
    scopes,
    timeZone: async () => timeZone,
    pollingIntervalSeconds: 0.5,
  });
  await runtime.start(registry);
  running.push(runtime);
  return { runtime, logs };
}

/** Промис, который разрешает обработчик задачи. */
function signal<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`select count(*)::int as n ${sql}`, params);
  return rows[0]?.n ?? -1;
}

/** Код ошибки Postgres (42501 — нет прав) или undefined. */
async function pgCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code ?? "no-code";
  }
}

describe("ADR-0020: pg-boss работает ролью приложения — только DML", () => {
  it("worker создаёт очередь, ставит, берёт и завершает задачу, ведёт расписание и проходит обслуживание без 42501", async () => {
    const boss = createBoss(bossDb(db.pool), "worker");
    const errors: unknown[] = [];
    boss.on("error", (error) => errors.push(error));
    await boss.start();
    try {
      await boss.createQueue("test.rights");
      const handled = new Promise<unknown>((resolve) => {
        void boss.work("test.rights", { pollingIntervalSeconds: 0.5 }, async ([job]) => {
          resolve(job?.data);
        });
      });
      await boss.send("test.rights", { n: 1 });
      expect(await handled).toEqual({ n: 1 });

      const manual = await boss.send("test.rights", { n: 2 }, { startAfter: 3600 });
      expect(manual).not.toBeNull();
      await boss.complete("test.rights", manual ?? "", null, { includeQueued: true });
      const [completed] = await boss.findJobs("test.rights", { id: manual ?? "" });
      expect(completed?.state).toBe("completed");

      await boss.schedule("test.rights", "0 3 * * *", null, { tz: "Europe/Minsk", missed: "once" });
      expect(await boss.getSchedules("test.rights")).toHaveLength(1);

      expect(await pgCode(() => boss.supervise())).toBeUndefined();
    } finally {
      await stopBoss(boss);
    }
    expect(errors).toEqual([]);
  });

  it("роль приложения не создаёт таблиц в схеме pgboss: права не расширены", async () => {
    expect(await pgCode(() => db.pool.query("create table pgboss.intruder (id int)"))).toBe(
      "42501",
    );
  });

  it("повторная установка схемы владельцем ничего не ломает: версия та же, очереди на месте", async () => {
    const client = await db.owner.connect();
    try {
      await installJobsSchema(bossDb(client));
    } finally {
      client.release();
    }
    const { rows } = await db.pool.query<{ name: string }>(
      "select name from pgboss.queue where name = 'test.rights'",
    );
    expect(rows).toHaveLength(1);
  });
});

const receiptPayload = z.object({ receiptId: z.uuid() });

describe("ADR-0008: постановка в транзакции данных (ScopedDb)", () => {
  it("коммит — и запись, и задача; откат — ни записи, ни задачи", async () => {
    const job = defineJob({ name: "test.in-tx", payload: receiptPayload, handle: async () => {} });
    const { runtime } = await startJobs("api", { jobs: [job] }, async () => true);
    const s = createScopedDb(db.pool, scopeA);
    const write = (fail: boolean) =>
      s.transaction(async (tx) => {
        const [row] = await tx
          .insert(fxReceipts)
          .values({ merchant: "Магазин", totalMinor: 100 })
          .returning({ id: fxReceipts.id });
        await runtime.enqueue(tx, job, { receiptId: row?.id ?? "" });
        if (fail) throw new Error("откат");
      });

    await expect(write(true)).rejects.toThrow("откат");
    expect(await count("from fx_receipts", [])).toBe(0);
    expect(await count("from pgboss.job where name = $1", ["test.in-tx"])).toBe(0);

    await write(false);
    expect(await count("from fx_receipts", [])).toBe(1);
    expect(await count("from pgboss.job where name = $1", ["test.in-tx"])).toBe(1);
  });
});

describe("PRIV-06: удаление аккаунта убирает ожидающие задачи домохозяйства", () => {
  it("discardHousehold удаляет задачи домохозяйства во всех очередях, задачи другого не трогает", async () => {
    const first = defineJob({
      name: "test.discard-a",
      payload: receiptPayload,
      handle: async () => {},
    });
    const second = defineJob({
      name: "test.discard-b",
      payload: receiptPayload,
      handle: async () => {},
    });
    const { runtime } = await startJobs("api", { jobs: [first, second] }, async () => true);
    const scopeB = testScope({ user: 2, household: 2 });
    const enqueue = (scope: Scope, job: typeof first) =>
      createScopedDb(db.pool, scope).transaction((tx) =>
        runtime.enqueue(tx, job, { receiptId: scope.userId }),
      );
    await enqueue(scopeA, first);
    await enqueue(scopeA, second);
    await enqueue(scopeB, first);

    expect(await runtime.discardHousehold(scopeA.householdId)).toBe(2);
    const left = await db.owner.query<{ household: string }>(
      "select data->'scope'->>'householdId' as household from pgboss.job where name like 'test.discard-%'",
    );
    expect(left.rows).toEqual([{ household: scopeB.householdId }]);
    expect(await runtime.discardHousehold(scopeA.householdId)).toBe(0);
  });
});

describe("SEC-04, OBS-01: задача выполняется от имени владельца из конверта", () => {
  it("обработчик получает ctx.s владельца и requestId запроса, поставившего задачу", async () => {
    const seen = signal<{ scope: Scope; requestId: string }>();
    const job = defineJob({
      name: "test.owner",
      payload: receiptPayload,
      handle: async (ctx) => seen.resolve({ scope: ctx.s.scope, requestId: ctx.requestId }),
    });
    const { runtime } = await startJobs("worker", { jobs: [job] }, async () => true);
    const s = createScopedDb(db.pool, scopeA);
    await withLogContext({ requestId: "req-owner-0001" }, () =>
      s.transaction((tx) => runtime.enqueue(tx, job, { receiptId: scopeA.userId })),
    );
    expect(await seen.promise).toEqual({ scope: scopeA, requestId: "req-owner-0001" });
  });

  it("пользователя нет или домохозяйство другое — задача отброшена: обработчик не вызван, в журнале dropped", async () => {
    const handled: Scope[] = [];
    const sentinel = signal<void>();
    const job = defineJob({
      name: "test.verify",
      payload: receiptPayload,
      handle: async (ctx) => {
        handled.push(ctx.s.scope);
        if (ctx.s.scope.userId === scopeA.userId) sentinel.resolve();
      },
    });
    // Есть только пользователь 1 в домохозяйстве 1.
    const { runtime, logs } = await startJobs(
      "worker",
      { jobs: [job] },
      async (c) => c.userId === scopeA.userId && c.householdId === scopeA.householdId,
    );
    const enqueue = (scope: Scope) =>
      createScopedDb(db.pool, scope).transaction((tx) =>
        runtime.enqueue(tx, job, { receiptId: scope.userId }),
      );
    await enqueue(testScope({ user: 3, household: 1 })); // пользователя нет
    await enqueue(testScope({ user: 1, household: 2 })); // домохозяйство другое
    await enqueue(scopeA); // задачи выполняются по порядку постановки: эта — последней
    await sentinel.promise;

    expect(handled).toEqual([scopeA]);
    expect(
      await count(
        "from background_job_run where kind = $1 and status = 'dropped' and error_code = 'FORBIDDEN'",
        ["test.verify"],
      ),
    ).toBe(2);
    expect(logs.lines().filter((line) => line["msg"] === "jobs.scope-rejected")).toHaveLength(2);
  });
});

/** Сколько строк лога с ключом msg. */
function logged(logs: ReturnType<typeof memoryLogger>, msg: string): number {
  return logs.lines().filter((line) => line["msg"] === msg).length;
}

describe("BUD-03: опрос очереди — своя частота у задачи, срочной для человека", () => {
  it("общий опрос раз в 30 с не мешает задаче с pollingIntervalSeconds: 0.5 выполниться за секунды", async () => {
    const urgent = defineJob({
      name: "test.urgent",
      payload: receiptPayload,
      options: { pollingIntervalSeconds: 0.5 },
      handle: async () => handled.resolve(performance.now()),
    });
    const handled = signal<number>();
    const scopes = createScopeVerifierRegistry();
    scopes.register(async () => true);
    const runtime = createJobs({
      pool: db.pool,
      role: "worker",
      log: memoryLogger().log,
      clock: new FakeClock("2026-10-21T09:00:00Z"),
      scopes,
      timeZone: async () => "Europe/Minsk",
      pollingIntervalSeconds: 30,
    });
    await runtime.start({ jobs: [urgent] });
    running.push(runtime);
    const s = createScopedDb(db.pool, scopeA);
    // Первый опрос уже прошёл вхолостую: следующий общий — через 30 с, у задачи — через 0,5 с.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const queuedAt = performance.now();
    await s.transaction((tx) => runtime.enqueue(tx, urgent, { receiptId: scopeA.userId }));
    expect((await handled.promise) - queuedAt).toBeLessThan(2_500);
  });
});

describe("SEC-04, ADR-0008: enqueue отвергает задачу, которую нельзя ставить", () => {
  it("ключ не через jobKey, задача не из реестра процесса, нагрузка не по схеме — ошибка, задачи нет", async () => {
    const bareKey = defineJob({
      name: "test.bare-key",
      payload: receiptPayload,
      // Ключ без домохозяйства подавил бы задачу другого домохозяйства (очередь short).
      options: { singletonKey: () => "budgets.recheck" },
      handle: async () => {},
    });
    const stranger = defineJob({
      name: "test.stranger",
      payload: receiptPayload,
      handle: async () => {},
    });
    const { runtime } = await startJobs("api", { jobs: [bareKey] }, async () => true);
    const s = createScopedDb(db.pool, scopeA);
    const enqueue = (run: Parameters<typeof s.transaction>[0]) => s.transaction(run);
    const receiptId = scopeA.userId;

    await expect(enqueue((tx) => runtime.enqueue(tx, bareKey, { receiptId }))).rejects.toThrow(
      "только jobKey",
    );
    await expect(enqueue((tx) => runtime.enqueue(tx, stranger, { receiptId }))).rejects.toThrow(
      "не зарегистрирована",
    );
    await expect(
      enqueue((tx) => runtime.enqueue(tx, bareKey, { receiptId: "не uuid" })),
    ).rejects.toThrow("не по схеме");
    expect(
      await count("from pgboss.job where name = any($1)", [["test.bare-key", "test.stranger"]]),
    ).toBe(0);
  });

  it("два определения с одним именем очереди или повторный start — ошибка при старте", async () => {
    const twin = () =>
      defineJob({ name: "test.twin", payload: receiptPayload, handle: async () => {} });
    await expect(startJobs("api", { jobs: [twin(), twin()] }, async () => true)).rejects.toThrow(
      "дважды",
    );
    const { runtime } = await startJobs("api", { jobs: [] }, async () => true);
    await expect(runtime.start({ jobs: [] })).rejects.toThrow("уже запущена");
  });
});

describe("SEC-04, OBS-07: конверт или нагрузка не по схеме — задача отброшена без вызова обработчика", () => {
  /** worker с задачей name; сторож — корректная задача, поставленная последней (задачи идут по порядку). */
  async function startGuarded(name: string) {
    const handled: unknown[] = [];
    const sentinel = signal<void>();
    const job = defineJob({
      name,
      payload: receiptPayload,
      handle: async (_ctx, payload) => {
        handled.push(payload);
        if (payload.receiptId === scopeA.userId) sentinel.resolve();
      },
    });
    const { runtime, logs } = await startJobs("worker", { jobs: [job] }, async () => true);
    // Сырая постановка мимо enqueue — так в очередь попадает конверт, который enqueue не собрал бы.
    const raw = async (envelopes: readonly object[]) => {
      const boss = createBoss(bossDb(db.pool), "api");
      await boss.start();
      try {
        for (const envelope of envelopes) await boss.send(name, envelope);
      } finally {
        await stopBoss(boss);
      }
    };
    const finish = async () => {
      await createScopedDb(db.pool, scopeA).transaction((tx) =>
        runtime.enqueue(tx, job, { receiptId: scopeA.userId }),
      );
      await sentinel.promise;
    };
    const dropped = () =>
      count(
        "from background_job_run where kind = $1 and status = 'dropped' and error_code = 'VALIDATION'",
        [name],
      );
    return { handled, logs, raw, finish, dropped };
  }

  const scope = { userId: scopeA.userId, householdId: scopeA.householdId };
  const payload = { receiptId: scopeA.userId };

  it("лишнее поле или владелец не uuid — dropped/VALIDATION, jobs.envelope-invalid, обработчик не вызван", async () => {
    const run = await startGuarded("test.bad-envelope");
    await run.raw([
      { scope, requestId: "req-extra-0001", payload, admin: true },
      { scope: { ...scope, userId: "не uuid" }, requestId: "req-baduid-01", payload },
    ]);
    await run.finish();

    expect(run.handled).toEqual([payload]);
    expect(await run.dropped()).toBe(2);
    expect(logged(run.logs, "jobs.envelope-invalid")).toBe(2);
  });

  it("конверт верный, нагрузка не по схеме — dropped/VALIDATION, jobs.payload-invalid, обработчик не вызван", async () => {
    const run = await startGuarded("test.bad-payload");
    await run.raw([{ scope, requestId: "req-payload-01", payload: {} }]);
    await run.finish();

    expect(run.handled).toEqual([payload]);
    expect(await run.dropped()).toBe(1);
    expect(logged(run.logs, "jobs.payload-invalid")).toBe(1);
  });
});

describe("ADR-0008: повтор — только для retryable-ошибок каталога", () => {
  it("UNAVAILABLE повторяется и проходит, CONFLICT не повторяется", async () => {
    const attempts = new Map<number, number>();
    const finished = signal<void>();
    const job = defineJob({
      name: "test.retry",
      payload: z.object({ n: z.number().int() }),
      options: { retryLimit: 2 },
      handle: async (_ctx, { n }) => {
        const attempt = (attempts.get(n) ?? 0) + 1;
        attempts.set(n, attempt);
        if (n === 1) throw new AppError("CONFLICT");
        if (n === 2 && attempt === 1) throw new AppError("UNAVAILABLE");
        if (n === 3 && attempts.get(2) === 2) finished.resolve();
      },
    });
    const { runtime } = await startJobs("worker", { jobs: [job] }, async () => true);
    const s = createScopedDb(db.pool, scopeA);
    for (const n of [1, 2, 3]) await s.transaction((tx) => runtime.enqueue(tx, job, { n }));
    await finished.promise;

    expect(Object.fromEntries(attempts)).toEqual({ 1: 1, 2: 2, 3: 1 });
    const { rows } = await db.owner.query<{ state: string; retry_count: number }>(
      "select state, retry_count from pgboss.job where name = $1 and data->'payload'->>'n' = '1'",
      ["test.retry"],
    );
    expect(rows).toEqual([{ state: "failed", retry_count: 0 }]);
    // OBS-07: упавший запуск — строка failed с кодом каталога.
    const failed = await db.owner.query<{ error_code: string }>(
      "select error_code from background_job_run where kind = $1 and status = 'failed' order by error_code",
      ["test.retry"],
    );
    expect(failed.rows).toEqual([{ error_code: "CONFLICT" }, { error_code: "UNAVAILABLE" }]);
  });
});

describe("NFR-22, NFR-23: расписания и обходы ведёт worker", () => {
  it("расписание ставится по поясу настройки clock.time-zone с missed: once", async () => {
    const schedule = defineSchedule({
      name: "test.nightly",
      cron: "0 3 * * *",
      stepDays: 1,
      handle: async () => {},
    });
    await startJobs("worker", { jobs: [], schedules: [schedule] }, async () => true, "Asia/Tokyo");
    const { rows } = await db.owner.query(
      "select timezone, cron, options->>'missed' as missed from pgboss.schedule where name = $1",
      ["test.nightly"],
    );
    expect(rows).toEqual([{ timezone: "Asia/Tokyo", cron: "0 3 * * *", missed: "once" }]);
  });

  it("обход fx_receipts находит владельцев (id, householdId, userId) и ставит задачу каждому под его scope", async () => {
    const owners = [testScope({ user: 1, household: 1 }), testScope({ user: 2, household: 2 })];
    const ids: string[] = [];
    for (const owner of owners) {
      const { rows } = await db.owner.query<{ id: string }>(
        `insert into fx_receipts (household_id, user_id, merchant, total_minor, status)
         values ($1, $2, 'Магазин', 100, 'stuck') returning id`,
        [owner.householdId, owner.userId],
      );
      ids.push(rows[0]?.id ?? "");
    }
    const seen: { scope: Scope; receiptId: string }[] = [];
    const all = signal<void>();
    const job = defineJob({
      name: "test.unstick",
      payload: receiptPayload,
      handle: async (ctx, { receiptId }) => {
        seen.push({ scope: ctx.s.scope, receiptId });
        if (seen.length === owners.length) all.resolve();
      },
    });
    const sweep = defineSweep({
      name: "test.stuck-receipts",
      cron: "0 0 1 1 *",
      find: findStuckReceipts,
      job,
      payload: (row) => ({ receiptId: row.id }),
    });
    await startJobs("worker", { jobs: [], sweeps: [sweep] }, async () => true);
    // Тик расписания вручную — та же задача, которую pg-boss ставит по cron.
    const tick = createBoss(bossDb(db.pool), "api");
    await tick.start();
    await tick.send("test.stuck-receipts", null);
    await stopBoss(tick);
    await all.promise;

    expect(seen.toSorted((a, b) => a.receiptId.localeCompare(b.receiptId))).toEqual(
      owners
        .map((scope, i) => ({ scope, receiptId: ids[i] ?? "" }))
        .toSorted((a, b) => a.receiptId.localeCompare(b.receiptId)),
    );
    // OBS-07: строка журнала на обход (её пишут до постановки задач — гонки с обработчиком нет).
    expect(await count("from background_job_run where kind = $1", ["test.stuck-receipts"])).toBe(1);
  });
});

describe("OBS-07, ADM-60: обзор фоновых задач для админки", () => {
  it("выполняются, последние ошибки и расписания с последним запуском — в любой роли, без данных пользователей", async () => {
    await db.owner.query("delete from background_job_run");
    const at = (iso: string) => new Date(iso);
    await db.owner.query(
      `insert into background_job_run (kind, schedule_key, status, progress, error_code, started_at, finished_at) values
       ('privacy.build-export', null, 'running', 40, null, $1, null),
       ('receipts.recognize', null, 'failed', null, 'UNAVAILABLE', $2, $2),
       ('receipts.recognize', null, 'dropped', null, 'FORBIDDEN', $3, $3),
       ('receipts.recognize', null, 'completed', null, null, $4, $4),
       ('test.overview-nightly', 'test.overview-nightly', 'completed', null, null, $2, $3),
       ('test.overview-nightly', 'test.overview-nightly', 'completed', null, null, $4, $4)`,
      [
        at("2026-10-21T08:59:00Z"),
        at("2026-10-21T07:00:00Z"),
        at("2026-10-21T08:00:00Z"),
        at("2026-10-21T08:30:00Z"),
      ],
    );
    const schedule = defineSchedule({
      name: "test.overview-nightly",
      cron: "0 3 * * *",
      stepDays: 1,
      handle: async () => {},
    });
    const { runtime } = await startJobs(
      "api",
      { jobs: [], schedules: [schedule] },
      async () => true,
    );
    const overview = await runtime.overview();
    expect(overview.running).toEqual([
      expect.objectContaining({ kind: "privacy.build-export", status: "running", progress: 40 }),
    ]);
    expect(overview.failures.map((run) => [run.status, run.errorCode])).toEqual([
      ["dropped", "FORBIDDEN"],
      ["failed", "UNAVAILABLE"],
    ]);
    expect(overview.schedules).toEqual([
      {
        name: "test.overview-nightly",
        cron: "0 3 * * *",
        lastRun: expect.objectContaining({
          status: "completed",
          startedAt: at("2026-10-21T08:30:00Z"),
        }),
      },
    ]);
  });
});
