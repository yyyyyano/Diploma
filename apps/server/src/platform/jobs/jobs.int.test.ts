// Очередь задач на настоящем Postgres под ролью приложения kosht_app (ADR-0008, ADR-0020). Ожидание обработки —
// промис, который разрешает сам обработчик (без sleep).
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bossDb } from "../db/boss-db.ts";
import { createBoss, stopBoss } from "./boss.ts";
import { installJobsSchema } from "./install.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

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
