// События на настоящем pg-boss под ролью приложения (ADR-0004, ADR-0008): публикация в транзакции данных и
// схлопывание «шторма». Ожидание обработки — промис, который разрешает обработчик (без sleep).
import type { Scope } from "@kosht/kernel";
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { migrateFixtures } from "../db/__fixtures__/fixture-db.ts";
import { fxReceipts } from "../db/__fixtures__/schema.ts";
import { createScopedDb } from "../db/scoped-db.ts";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import type { BossRole } from "../jobs/boss.ts";
import { jobKey } from "../jobs/job-key.ts";
import { createJobs, type JobsRuntime } from "../jobs/jobs.ts";
import { createScopeVerifierRegistry } from "../jobs/scope-verifier.ts";
import { defineEvent } from "./define-event.ts";
import { defineSubscription, type SubscriptionDef } from "./define-subscription.ts";
import { createEvents } from "./events.ts";

const scopeA = testScope({ user: 1, household: 1 });
const scopeB = testScope({ user: 2, household: 2 });

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

/** Процесс роли role с подписками: очередь задач и публикация событий через неё. */
async function startProcess(role: BossRole, subscriptions: readonly SubscriptionDef[]) {
  const scopes = createScopeVerifierRegistry();
  scopes.register(async () => true);
  const jobs = createJobs({
    pool: db.pool,
    role,
    log: memoryLogger().log,
    clock: new FakeClock("2026-10-21T09:00:00Z"),
    scopes,
    timeZone: async () => "Europe/Minsk",
    pollingIntervalSeconds: 0.5,
  });
  await jobs.start({ jobs: subscriptions.map((subscription) => subscription.job) });
  running.push(jobs);
  return createEvents({ jobs, subscriptions });
}

async function queued(queue: string): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(
    "select count(*)::int as n from pgboss.job where name = $1",
    [queue],
  );
  return rows[0]?.n ?? -1;
}

const created = defineEvent({
  name: "test.created",
  payload: z.object({ ids: z.array(z.uuid()) }),
});

describe("ADR-0008: событие публикуется в транзакции записи", () => {
  it("откат — ни записи, ни события; коммит — и запись, и задача подписчика", async () => {
    const subscription = defineSubscription({
      event: created,
      module: "audit",
      handle: async () => {},
    });
    const events = await startProcess("api", [subscription]);
    const s = createScopedDb(db.pool, scopeA);
    const write = (fail: boolean) =>
      s.transaction(async (tx) => {
        const [row] = await tx
          .insert(fxReceipts)
          .values({ merchant: "Магазин", totalMinor: 100 })
          .returning({ id: fxReceipts.id });
        await events.publish(tx, created, { ids: [row?.id ?? ""] });
        if (fail) throw new Error("откат");
      });

    await expect(write(true)).rejects.toThrow("откат");
    expect(await queued(subscription.job.name)).toBe(0);
    await write(false);
    expect(await queued(subscription.job.name)).toBe(1);
    const { rows } = await db.owner.query<{ n: number }>(
      "select count(*)::int as n from fx_receipts",
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe("ADR-0008, ARCHITECTURE §15: «шторм» событий схлопывается по jobKey", () => {
  const changed = defineEvent({
    name: "test.changed",
    payload: z.object({ ids: z.array(z.uuid()) }),
  });

  it("300 публикаций с одним ключом до старта обработки — обработчик отработал не больше 5 раз", async () => {
    let runs = 0;
    const first = Promise.withResolvers<void>();
    const subscription = defineSubscription({
      event: changed,
      module: "budgets",
      options: { singletonKey: (_p, scope) => jobKey(scope, "budgets.recheck") },
      handle: async () => {
        runs += 1;
        first.resolve();
      },
    });
    const api = await startProcess("api", [subscription]);
    const s = createScopedDb(db.pool, scopeA);
    for (let i = 0; i < 300; i += 1) {
      await s.transaction((tx) => api.publish(tx, changed, { ids: [scopeA.userId] }));
    }
    const pending = await queued(subscription.job.name);
    expect(pending).toBeGreaterThanOrEqual(1);
    expect(pending).toBeLessThanOrEqual(5);

    await startProcess("worker", [subscription]);
    await first.promise;
    // Больше задач, чем стоит в очереди, обработчик не получит.
    expect(runs).toBeLessThanOrEqual(5);
    expect(await queued(subscription.job.name)).toBe(pending);
  });

  it("одинаковый ключ двух домохозяйств — обе задачи выполняются, друг друга не подавляют", async () => {
    const seen = new Set<string>();
    const both = Promise.withResolvers<void>();
    const subscription = defineSubscription({
      event: changed,
      module: "goals",
      options: { singletonKey: (_p, scope) => jobKey(scope, "goals.recheck") },
      handle: async (ctx) => {
        seen.add(ctx.s.scope.householdId);
        if (seen.size === 2) both.resolve();
      },
    });
    const events = await startProcess("worker", [subscription]);
    for (const scope of [scopeA, scopeB] satisfies Scope[]) {
      await createScopedDb(db.pool, scope).transaction((tx) =>
        events.publish(tx, changed, { ids: [scope.userId] }),
      );
    }
    await both.promise;
    expect([...seen].toSorted()).toEqual([scopeA.householdId, scopeB.householdId].toSorted());
  });
});
