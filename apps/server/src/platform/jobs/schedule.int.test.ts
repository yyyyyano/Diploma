// Догон расписания на FakeClock (NFR-22): «ровно один догоняющий запуск» проверяется здесь, на водяном знаке в
// background_job_run, — настоящий pg-boss по cron в тесте не дождаться; что pg-boss получает missed: "once",
// проверяет jobs.int.test.ts.
import type { Period } from "@kosht/kernel";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../db/system-db.ts";
import { AppError } from "../errors/app-error.ts";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import { defineSchedule, runSchedule, type ScheduleDef } from "./schedule.ts";

const DAY_MS = 86_400_000;

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

/** Расписание с журналом вызовов обработчика; failWith — бросить в следующем вызове. */
function recordingSchedule(name: string) {
  const calls: (readonly Period[])[] = [];
  let failWith: Error | undefined;
  const schedule: ScheduleDef = defineSchedule({
    name,
    cron: "0 3 * * *",
    stepDays: 1,
    handle: async (_ctx, periods) => {
      calls.push(periods);
      const error = failWith;
      failWith = undefined;
      if (error !== undefined) throw error;
    },
  });
  return { schedule, calls, failNext: (error: Error) => (failWith = error) };
}

function tick(schedule: ScheduleDef, clock: FakeClock) {
  const { log } = memoryLogger();
  return runSchedule(
    schedule,
    { system: createSystemDb(db.pool), clock, log },
    { requestId: "tick-00000001", log, signal: new AbortController().signal },
  );
}

describe("NFR-22: догон расписания после простоя", () => {
  it("после трёх дней простоя — ровно один догоняющий запуск со всеми пропущенными днями", async () => {
    const { schedule, calls } = recordingSchedule("test.daily-catch-up");
    const clock = new FakeClock("2026-10-21T00:30:00Z"); // 03:30 по Минску
    expect(await tick(schedule, clock)).toBe("completed");
    expect(calls).toEqual([[{ from: "2026-10-20", to: "2026-10-20" }]]);

    clock.advance(4 * DAY_MS); // компьютер выключен, проснулись 25-го
    expect(await tick(schedule, clock)).toBe("completed");
    expect(await tick(schedule, clock)).toBe("idle"); // повторный тик того же дня
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([
      { from: "2026-10-21", to: "2026-10-21" },
      { from: "2026-10-22", to: "2026-10-22" },
      { from: "2026-10-23", to: "2026-10-23" },
      { from: "2026-10-24", to: "2026-10-24" },
    ]);
  });

  it("упавший прогон не двигает водяной знак: следующий тик получает те же дни", async () => {
    const { schedule, calls, failNext } = recordingSchedule("test.daily-retry");
    const clock = new FakeClock("2026-10-21T00:30:00Z");
    failNext(new AppError("UNAVAILABLE"));
    expect(await tick(schedule, clock)).toBe("retry");
    expect(await tick(schedule, clock)).toBe("completed");
    expect(calls).toEqual([
      [{ from: "2026-10-20", to: "2026-10-20" }],
      [{ from: "2026-10-20", to: "2026-10-20" }],
    ]);
  });

  it("ошибка не из каталога или без повтора — failed, повтора не будет", async () => {
    const { schedule, failNext } = recordingSchedule("test.daily-broken");
    failNext(new Error("сбой"));
    expect(await tick(schedule, new FakeClock("2026-10-21T00:30:00Z"))).toBe("failed");
    const { rows } = await db.pool.query(
      "select status, error_code, watermark from background_job_run where schedule_key = $1",
      ["test.daily-broken"],
    );
    expect(rows).toEqual([{ status: "failed", error_code: "INTERNAL", watermark: null }]);
  });
});
