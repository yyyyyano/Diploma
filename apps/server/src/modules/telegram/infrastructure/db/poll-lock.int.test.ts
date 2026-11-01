// TG-10: опрашивает один экземпляр бота — замок консультативный, второй ждёт; отпустили или потеряли соединение —
// замок свободен, а держатель узнаёт о потере (`lost`).
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../../platform/db/system-db.ts";
import { acquirePollLock } from "./poll-lock.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const noErrors = () => undefined;

describe("TG-10: замок опроса", () => {
  it("второй экземпляр замок не получает, пока первый держит; после отпускания — получает", async () => {
    const system = createSystemDb(db.pool);
    const first = await acquirePollLock(system, noErrors, 50);
    expect(first).toBeDefined();
    expect(await acquirePollLock(system, noErrors, 50)).toBeUndefined();
    await first?.release();
    const second = await acquirePollLock(system, noErrors, 50);
    expect(second).toBeDefined();
    await second?.release();
  });

  it("соединение держателя оборвали — замок потерян (lost), другой экземпляр берёт его", async () => {
    const system = createSystemDb(db.pool);
    const errors: unknown[] = [];
    const holder = await acquirePollLock(system, (error) => errors.push(error), 50);
    if (holder === undefined) throw new Error("замок не взят");
    await db.owner.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid()
          and state = 'idle in transaction'`,
    );
    await holder.lost;
    expect(errors.length).toBeGreaterThan(0);
    const next = await acquirePollLock(system, noErrors, 50);
    expect(next).toBeDefined();
    await next?.release();
  });
});
