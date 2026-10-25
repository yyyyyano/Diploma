// InlineJobs (@kosht/testing) — та же форма, что у порта Jobs: присваивание ниже проверяет её при компиляции, а тест —
// что настоящий обработчик defineJob и подписка события выполняются сразу в транзакции постановки.
import { InlineJobs, testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ScopedDb } from "../db/scoped-db.ts";
import { defineEvent } from "../events/define-event.ts";
import { defineSubscription } from "../events/define-subscription.ts";
import { createEvents } from "../events/events.ts";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import { defineJob, type JobDef } from "./define-job.ts";
import type { Jobs } from "./jobs.ts";

const { log } = memoryLogger();
/** Транзакция сценария: InlineJobs передаёт её обработчику как ctx.s. */
const tx = { scope: testScope() } as ScopedDb;

/** Обработчик по имени из настоящих определений: нагрузка — по схеме задачи, ctx.s — транзакция постановки. */
function inline(defs: readonly JobDef[]): Jobs {
  return new InlineJobs<ScopedDb>((name) => {
    const job = defs.find((def) => def.name === name);
    if (job === undefined) return undefined;
    return async (s, payload) => {
      const parsed = job.payload.safeParse(payload);
      if (!parsed.success) throw new Error(`нагрузка ${name} не по схеме`);
      await job.handle(
        {
          s,
          requestId: "inline-0001",
          log,
          signal: new AbortController().signal,
          progress: async () => {},
        },
        parsed.data,
      );
    };
  });
}

describe("ARCHITECTURE §4.4: InlineJobs вместо pg-boss в тестах сценариев", () => {
  it("задача выполняется сразу, ctx.s — транзакция, в которой её поставили", async () => {
    const seen: { scope: unknown; receiptId: string }[] = [];
    const job = defineJob({
      name: "receipts.recognize",
      payload: z.object({ receiptId: z.uuid() }),
      handle: async (ctx, { receiptId }) => {
        seen.push({ scope: ctx.s.scope, receiptId });
      },
    });
    const receiptId = testScope().userId;
    await inline([job]).enqueue(tx, job, { receiptId });
    expect(seen).toEqual([{ scope: tx.scope, receiptId }]);
  });

  it("событие через InlineJobs сразу доходит до подписчика", async () => {
    const changed = defineEvent({
      name: "transactions.changed",
      payload: z.object({ ids: z.array(z.uuid()) }),
    });
    const got: string[][] = [];
    const subscription = defineSubscription({
      event: changed,
      module: "budgets",
      handle: async (_ctx, { ids }) => {
        got.push([...ids]);
      },
    });
    const events = createEvents({
      jobs: inline([subscription.job]),
      subscriptions: [subscription],
    });
    await events.publish(tx, changed, { ids: [testScope().userId] });
    expect(got).toEqual([[testScope().userId]]);
  });

  it("задача без обработчика — ошибка, а не тихий пропуск", async () => {
    const job = defineJob({ name: "unknown.job", payload: z.object({}), handle: async () => {} });
    await expect(inline([]).enqueue(tx, job, {})).rejects.toThrow("нет обработчика");
  });
});
