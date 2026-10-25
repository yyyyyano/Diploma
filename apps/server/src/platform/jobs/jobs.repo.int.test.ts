import { LocalDate } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSystemDb, type SystemDb } from "../db/system-db.ts";
import {
  finishRun,
  lastWatermark,
  recordDropped,
  RETENTION_DAYS,
  setProgress,
  startRun,
} from "./jobs.repo.ts";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-10-21T09:00:00Z");

let db: TestDb;
let system: SystemDb;
beforeAll(async () => {
  db = await createTestDb();
  system = createSystemDb(db.pool);
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.pool.query("delete from background_job_run");
});

async function rows() {
  const { rows: all } = await db.pool.query<{
    kind: string;
    status: string;
    progress: number | null;
    watermark: string | null;
    error_code: string | null;
  }>(
    "select kind, status, progress, watermark::text, error_code from background_job_run order by started_at",
  );
  return all;
}

describe("OBS-07: журнал фоновых задач", () => {
  it("запуск пишет строку running, прогресс и итог с кодом ошибки — без текста ошибки", async () => {
    const id = await startRun(system, { kind: "receipts.recognize", startedAt: NOW });
    await setProgress(system, id, 40);
    expect(await rows()).toMatchObject([
      { kind: "receipts.recognize", status: "running", progress: 40 },
    ]);
    await finishRun(system, id, { status: "failed", finishedAt: NOW, errorCode: "UNAVAILABLE" });
    expect(await rows()).toMatchObject([{ status: "failed", error_code: "UNAVAILABLE" }]);
  });

  it("отброшенная задача — одна завершённая строка dropped с кодом", async () => {
    await recordDropped(system, {
      kind: "budgets.recheck",
      startedAt: NOW,
      errorCode: "FORBIDDEN",
    });
    expect(await rows()).toMatchObject([
      { kind: "budgets.recheck", status: "dropped", error_code: "FORBIDDEN" },
    ]);
  });

  it("прогресс вне 0…100 база не принимает", async () => {
    const id = await startRun(system, { kind: "legal-base.load", startedAt: NOW });
    await expect(setProgress(system, id, 101)).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});

describe("NFR-22: водяной знак расписания платформы", () => {
  it("водяной знак — последний день завершённого запуска; упавший запуск его не двигает", async () => {
    const key = "platform.cleanup";
    expect(await lastWatermark(system, key)).toBeUndefined();
    const first = await startRun(system, { kind: key, scheduleKey: key, startedAt: NOW });
    await finishRun(system, first, {
      status: "completed",
      finishedAt: NOW,
      watermark: LocalDate.parse("2026-10-20"),
    });
    const failed = await startRun(system, { kind: key, scheduleKey: key, startedAt: NOW });
    await finishRun(system, failed, {
      status: "failed",
      finishedAt: NOW,
      errorCode: "INTERNAL",
      watermark: LocalDate.parse("2026-10-25"),
    });
    expect(await lastWatermark(system, key)).toBe("2026-10-20");
    expect(await lastWatermark(system, "other.schedule")).toBeUndefined();
  });

  it(`строки старше ${RETENTION_DAYS} дней удаляются, а строка с текущим водяным знаком — нет`, async () => {
    const old = new Date(NOW.getTime() - (RETENTION_DAYS + 5) * DAY_MS);
    const key = "platform.monthly";
    const watermarkRun = await startRun(system, { kind: key, scheduleKey: key, startedAt: old });
    await finishRun(system, watermarkRun, {
      status: "completed",
      finishedAt: old,
      watermark: LocalDate.parse("2026-09-01"),
    });
    await startRun(system, { kind: "receipts.recognize", startedAt: old });
    await startRun(system, { kind: "receipts.recognize", startedAt: NOW });
    expect((await rows()).map((row) => [row.kind, row.watermark])).toEqual([
      [key, "2026-09-01"],
      ["receipts.recognize", null],
    ]);
    expect(await lastWatermark(system, key)).toBe("2026-09-01");
  });
});
