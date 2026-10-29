// PRIV-06, OBS-05 на Postgres: трассы удаляются сразу, если Langfuse ответил; недоступен или выключен — пользователь
// в очереди повторов (без scope), удаление аккаунта не падает; ежедневный повтор чистит очередь, когда Langfuse ожил.
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { TraceDeleter } from "./ports.ts";
import { makeTraceDeletion } from "./trace-deletion.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

/** Langfuse, который то падает, то отвечает: переключается флагом up. */
function switchableLangfuse() {
  const state = { up: false, deletedFor: [] as string[] };
  const deleter: TraceDeleter = {
    deleteUserTraces: async (userId) => {
      if (!state.up) throw new Error("ECONNREFUSED 127.0.0.1:3001");
      state.deletedFor.push(userId);
      return 3;
    },
    deleteTracesBefore: async () => 0,
  };
  return { state, deleter };
}

function setup(deleter: TraceDeleter | undefined) {
  const clock = new FakeClock("2026-10-26T09:00:00Z");
  const logs = memoryLogger();
  const traces = makeTraceDeletion({
    platform: { system: createSystemDb(db.pool), clock, log: logs.log },
    deleter,
  });
  return { clock, logs, traces };
}

async function queue() {
  return (
    await db.owner.query<{ user_id: string; attempts: number }>(
      "select user_id, attempts from llm_trace_deletions order by user_id",
    )
  ).rows;
}

describe("PRIV-06, OBS-05: трассы Langfuse при удалении аккаунта", () => {
  it("Langfuse отвечает — трассы удалены, очередь пуста", async () => {
    const langfuse = switchableLangfuse();
    langfuse.state.up = true;
    const scope = testScope({ user: 1, household: 1 });
    await setup(langfuse.deleter).traces.deleteUserTraces(scope);
    expect(langfuse.state.deletedFor).toEqual([scope.userId]);
    expect(await queue()).toEqual([]);
  });

  it("Langfuse недоступен — не бросает, пользователь в очереди; повтор после оживления очищает очередь", async () => {
    await db.owner.query("delete from llm_trace_deletions");
    const langfuse = switchableLangfuse();
    const { traces, logs } = setup(langfuse.deleter);
    const scope = testScope({ user: 2, household: 2 });
    await traces.deleteUserTraces(scope);
    await traces.deleteUserTraces(scope);
    expect(await queue()).toEqual([{ user_id: scope.userId, attempts: 0 }]);
    expect(logs.lines().some((line) => line["msg"] === "llm.trace-deletion-queued")).toBe(true);

    await traces.retryQueued();
    expect(await queue()).toEqual([{ user_id: scope.userId, attempts: 1 }]);

    langfuse.state.up = true;
    await traces.retryQueued();
    expect(await queue()).toEqual([]);
    expect(langfuse.state.deletedFor).toEqual([scope.userId]);
  });

  it("Langfuse выключен — пользователь ждёт в очереди, повтор ничего не трогает", async () => {
    await db.owner.query("delete from llm_trace_deletions");
    const { traces } = setup(undefined);
    const scope = testScope({ user: 3, household: 3 });
    await traces.deleteUserTraces(scope);
    await traces.retryQueued();
    expect(await queue()).toEqual([{ user_id: scope.userId, attempts: 0 }]);
  });
});
