// LLM-06, OBS-05: ночные задачи хранения — журнал расхода (90 дней) и трассы Langfuse (30 дней); сроки — настройки.
// Журнал на настоящем Postgres: старше срока удаляется пачками, свежее остаётся; расписания названы и стоят ночью.
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { SettingDef } from "../../../platform/settings/settings.ts";
import { LLM_TRACE_RETENTION_DAYS, LLM_USAGE_RETENTION_DAYS } from "../settings.ts";
import { makeRetention, USAGE_BATCH } from "./retention.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const NOW = "2026-10-29T03:20:00Z";

function setup(
  options: { usageDays?: number; traceDays?: number; deleteBefore?: (d: Date) => void } = {},
) {
  const values = new Map<string, unknown>([
    [LLM_USAGE_RETENTION_DAYS.key, options.usageDays ?? 90],
    [LLM_TRACE_RETENTION_DAYS.key, options.traceDays ?? 30],
  ]);
  return makeRetention({
    platform: {
      system: createSystemDb(db.pool),
      clock: new FakeClock(NOW),
      log: memoryLogger().log,
      settings: {
        get: async <T>(def: SettingDef<T>) => values.get(def.key) as T,
      } as never,
    },
    deleter: {
      deleteUserTraces: async () => 0,
      deleteTracesBefore: async (before) => {
        options.deleteBefore?.(before);
        return 7;
      },
    },
  });
}

async function seedUsage(daysAgo: number, count: number) {
  await db.owner.query(
    `insert into llm_usage (task, provider, model, input_tokens, output_tokens, ms, cost_micros, created_at)
     select 'chat', 'groq', 'a', 1, 1, 1, 0, $1::timestamptz - make_interval(days => $2)
     from generate_series(1, $3)`,
    [NOW, daysAgo, count],
  );
}

describe("LLM-06: журнал расхода хранится 90 дней", () => {
  it("старше срока удаляется, свежее остаётся; повтор ничего не находит", async () => {
    await db.owner.query("delete from llm_usage");
    await seedUsage(120, 3);
    await seedUsage(91, 2);
    await seedUsage(89, 4);
    await seedUsage(1, 1);
    const retention = setup();
    expect(await retention.purgeUsage()).toBe(5);
    expect((await db.owner.query("select count(*)::int as n from llm_usage")).rows).toEqual([
      { n: 5 },
    ]);
    expect(await retention.purgeUsage()).toBe(0);
  });

  it("срок — настройка: при 30 днях уходит и то, что моложе 90", async () => {
    await db.owner.query("delete from llm_usage");
    await seedUsage(45, 2);
    await seedUsage(5, 2);
    expect(await setup({ usageDays: 30 }).purgeUsage()).toBe(2);
  });

  it("больше пачки — удаляется всё, пачками по 1000 строк", async () => {
    await db.owner.query("delete from llm_usage");
    await seedUsage(200, USAGE_BATCH * 2 + 5);
    expect(await setup().purgeUsage()).toBe(USAGE_BATCH * 2 + 5);
    expect((await db.owner.query("select 1 from llm_usage")).rowCount).toBe(0);
  });
});

describe("OBS-05: трассы Langfuse хранятся 30 дней", () => {
  it("на удаление уходит граница «сейчас − 30 дней» и сколько отправлено — в ответе", async () => {
    let seen: Date | undefined;
    const retention = setup({ deleteBefore: (before) => (seen = before) });
    expect(await retention.purgeTraces()).toBe(7);
    expect(seen?.toISOString()).toBe("2026-09-29T03:20:00.000Z");
  });

  it("Langfuse выключен — чистить нечего", async () => {
    const retention = makeRetention({
      platform: {
        system: createSystemDb(db.pool),
        clock: new FakeClock(NOW),
        log: memoryLogger().log,
        settings: { get: async (def: SettingDef<unknown>) => def.default } as never,
      },
      deleter: undefined,
    });
    expect(await retention.purgeTraces()).toBe(0);
  });
});

describe("расписания хранения", () => {
  it("называются llm.usage-retention и llm.trace-retention и идут ночью, раз в сутки", () => {
    const retention = setup();
    expect(retention.usageSchedule).toMatchObject({ name: "llm.usage-retention", stepDays: 1 });
    expect(retention.traceSchedule).toMatchObject({ name: "llm.trace-retention", stepDays: 1 });
    expect(retention.usageSchedule.cron).toMatch(/^\d+ 3 \* \* \*$/);
    expect(retention.traceSchedule.cron).toMatch(/^\d+ 3 \* \* \*$/);
  });
});
