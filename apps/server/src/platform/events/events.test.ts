import { testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ScopedDb } from "../db/scoped-db.ts";
import type { Jobs } from "../jobs/jobs.ts";
import { defineEvent, MAX_EVENT_IDS } from "./define-event.ts";
import { defineSubscription } from "./define-subscription.ts";
import { createEvents } from "./events.ts";

const changed = defineEvent({
  name: "transactions.changed",
  payload: z.object({ ids: z.array(z.uuid()) }),
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = (count: number) => Array.from({ length: count }, (_, i) => id(i + 1));

/** Очередь, которая только записывает постановки; транзакция ей не нужна. */
function recordingJobs() {
  const sent: { job: string; payload: unknown }[] = [];
  const jobs: Jobs = {
    enqueue: async (_tx, job, payload) => {
      sent.push({ job: job.name, payload });
    },
  };
  return { jobs, sent };
}
const tx = { scope: testScope() } as ScopedDb;

describe("ADR-0004: defineEvent", () => {
  it("имя не <модуль>.<прошедшее время> или нагрузка без пачки ids — ошибка при определении", () => {
    expect(() =>
      defineEvent({ name: "Changed", payload: z.object({ ids: z.array(z.uuid()) }) }),
    ).toThrow(RangeError);
    expect(() =>
      defineEvent({ name: "receipts.recognized", payload: z.object({ receiptId: z.uuid() }) }),
    ).toThrow("ids");
  });
});

describe("ADR-0008: events.publish", () => {
  it("подписчиков нет — публикация проходит и ничего не ставит", async () => {
    const { jobs, sent } = recordingJobs();
    await createEvents({ jobs, subscriptions: [] }).publish(tx, changed, { ids: [id(1)] });
    expect(sent).toEqual([]);
  });

  it("каждому подписчику — своя задача очереди evt.<событие>.<модуль> с той же нагрузкой", async () => {
    const { jobs, sent } = recordingJobs();
    const subscriptions = ["budgets", "recurring"].map((module) =>
      defineSubscription({ event: changed, module, handle: async () => {} }),
    );
    await createEvents({ jobs, subscriptions }).publish(tx, changed, { ids: [id(1), id(2)] });
    expect(sent).toEqual([
      { job: "evt.transactions.changed.budgets", payload: { ids: [id(1), id(2)] } },
      { job: "evt.transactions.changed.recurring", payload: { ids: [id(1), id(2)] } },
    ]);
  });

  it(`пачка из ${MAX_EVENT_IDS} id проходит, из ${MAX_EVENT_IDS + 1} и пустая — ошибка, задач нет`, async () => {
    const { jobs, sent } = recordingJobs();
    const events = createEvents({
      jobs,
      subscriptions: [
        defineSubscription({ event: changed, module: "budgets", handle: async () => {} }),
      ],
    });
    await expect(events.publish(tx, changed, { ids: ids(MAX_EVENT_IDS + 1) })).rejects.toThrow(
      RangeError,
    );
    await expect(events.publish(tx, changed, { ids: [] })).rejects.toThrow(RangeError);
    expect(sent).toEqual([]);
    await events.publish(tx, changed, { ids: ids(MAX_EVENT_IDS) });
    expect(sent).toHaveLength(1);
  });

  it("модуль подписан на событие дважды — ошибка при старте", () => {
    const twice = [1, 2].map(() =>
      defineSubscription({ event: changed, module: "budgets", handle: async () => {} }),
    );
    expect(() => createEvents({ jobs: recordingJobs().jobs, subscriptions: twice })).toThrow(
      "дважды",
    );
  });
});

describe("ADR-0008: ключ схлопывания подписки", () => {
  const subscription = defineSubscription({
    event: changed,
    module: "budgets",
    handle: async () => {},
  });
  const key = (scope = testScope(), payload = { ids: [id(1)] }) =>
    subscription.job.options.singletonKey?.(payload, scope);

  it("без ключа модуля — одинаковые события домохозяйства схлопываются, разные — нет", () => {
    expect(key()).toBe(key());
    expect(key(testScope(), { ids: [id(2)] })).not.toBe(key());
  });

  it("одинаковые события двух домохозяйств друг друга не подавляют", () => {
    expect(key(testScope({ user: 2, household: 2 }))).not.toBe(key());
  });
});
