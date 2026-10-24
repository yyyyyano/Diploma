// Шаблонная база на тестовый файл (ARCHITECTURE §12, ADR-0007): клоны независимы, удаляются только test_*,
// базы упавших прогонов убираются следующим.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createTestDb, dropDatabase, dropOrphans, type TestDb } from "./db.ts";

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
    const { rows } = await first.pool.query(
      "select count(*)::int as n from drizzle.__drizzle_migrations",
    );
    expect(rows[0]?.n).toBeGreaterThan(0);
  });

  it("клоны независимы: таблица одного не видна в другом", async () => {
    await first.pool.query("create table fx_only_first (n int)");
    const { rows } = await second.pool.query("select to_regclass('fx_only_first') as t");
    expect(rows[0]?.t).toBeNull();
  });

  it("имя клона — test_<запуск>_<процесс>_<номер>", () => {
    expect(first.name).toMatch(new RegExp(`^test_${context.runId}_${process.pid}_\\d+$`));
  });
});

describe("защита по префиксу test_", () => {
  it("рабочую базу удалить нельзя — ошибка до запроса, база на месте", async () => {
    await expect(dropDatabase(context.connection, context.connection.database)).rejects.toThrow(
      /только test_/,
    );
    expect(await databaseExists(context.connection.database)).toBe(true);
  });

  it("базы прогона, процесса которого нет, удаляются; базы живого прогона — нет", async () => {
    const orphan = await createTestDb({ ...context, runId: "999999999" });
    await orphan.pool.end();
    const dropped = await dropOrphans(context.connection);
    expect(dropped).toContain(orphan.name);
    expect(dropped).not.toContain(first.name);
    expect(await databaseExists(orphan.name)).toBe(false);
    expect(await databaseExists(first.name)).toBe(true);
  });
});
