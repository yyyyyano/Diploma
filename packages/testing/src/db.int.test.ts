// Шаблонная база на тестовый файл (ARCHITECTURE §12, ADR-0007): клоны независимы, удаляются только test_*,
// базы упавших прогонов убираются следующим.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createTestDb, dropDatabase, dropOrphans, dropTestRole, type TestDb } from "./db.ts";

const context = inject("testDb");
let first: TestDb;
let second: TestDb;

beforeAll(async () => {
  first = await createTestDb();
  second = await createTestDb();
});
afterAll(async () => {
  await first.drop();
  await second.drop();
});

async function databaseExists(name: string): Promise<boolean> {
  const { rows } = await first.pool.query("select 1 from pg_database where datname = $1", [name]);
  return rows.length === 1;
}

describe("createTestDb — своя база на файл из шаблона", () => {
  it("клон уже содержит боевые миграции шаблона", async () => {
    const { rows } = await first.owner.query(
      "select count(*)::int as n from drizzle.__drizzle_migrations",
    );
    expect(rows[0]?.n).toBeGreaterThan(0);
  });

  it("клоны независимы: таблица одного не видна в другом", async () => {
    await first.owner.query("create table fx_only_first (n int)");
    const { rows } = await second.pool.query("select to_regclass('fx_only_first') as t");
    expect(rows[0]?.t).toBeNull();
  });

  it("имя клона — test_<запуск>_<процесс>_<номер>", () => {
    expect(first.name).toMatch(new RegExp(`^test_${context.runId}_${process.pid}_\\d+$`));
  });
});

describe("защита по префиксу test_", () => {
  it("рабочую базу удалить нельзя — ошибка до запроса, база на месте", async () => {
    await expect(dropDatabase(context.admin, context.admin.database)).rejects.toThrow(
      /только test_/,
    );
    expect(await databaseExists(context.admin.database)).toBe(true);
  });

  it("базы прогона, процесса которого нет, удаляются; базы живого прогона — нет", async () => {
    const orphan = await createTestDb({ ...context, runId: "999999999" });
    await orphan.pool.end();
    await orphan.owner.end();
    const dropped = await dropOrphans(context.admin);
    expect(dropped).toContain(orphan.name);
    expect(dropped).not.toContain(first.name);
    expect(await databaseExists(orphan.name)).toBe(false);
    expect(await databaseExists(first.name)).toBe(true);
  });

  it("роль test_* прогона, процесса которого нет, удаляется вместе с базами", async () => {
    const orphan = "test_999999999_1_r1";
    await first.owner.query(`create role ${orphan}`);
    expect(await dropOrphans(context.admin)).toContain(orphan);
    const { rows } = await first.owner.query("select 1 from pg_roles where rolname = $1", [orphan]);
    expect(rows).toEqual([]);
  });

  it("роль без префикса test_ удалить нельзя — ошибка до запроса", async () => {
    await expect(dropTestRole(context.admin, context.app.user)).rejects.toThrow(/только test_/);
  });
});

describe("drop() — сеансы удаляемой базы", () => {
  const shutdown = () =>
    Object.assign(new Error("terminating connection due to administrator command"), {
      code: "57P01",
    });

  it("57P01 до drop() — ошибка теста, а не тишина", async () => {
    const db = await createTestDb();
    try {
      expect(() => db.pool.emit("error", shutdown())).toThrow("administrator command");
    } finally {
      await db.drop();
    }
  });

  it("во время drop() 57P01 от закрывающегося соединения ожидаем; любая другая ошибка пула — по-прежнему ошибка", async () => {
    const db = await createTestDb();
    await db.pool.query("select 1");
    await db.owner.query("select 1");
    await db.drop();
    expect(() => db.pool.emit("error", shutdown())).not.toThrow();
    expect(() => db.owner.emit("error", shutdown())).not.toThrow();
    const other = Object.assign(new Error("другая ошибка"), { code: "08006" });
    expect(() => db.pool.emit("error", other)).toThrow("другая ошибка");
  });
});
