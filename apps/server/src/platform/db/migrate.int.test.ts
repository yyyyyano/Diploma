import { createTestDb, type TestDb } from "@kosht/testing/db";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MIGRATION_LOCK, runMigrations } from "./migrate.ts";

const COUNTER_DIR = fileURLToPath(new URL("__fixtures__/counter-migrations", import.meta.url));

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("ADR-0007: миграции применяет приложение при старте", () => {
  it("первая ручная миграция создала расширения vector и pg_trgm", async () => {
    const { rows } = await db.owner.query<{ extname: string }>(
      "select extname from pg_extension where extname in ('vector', 'pg_trgm') order by extname",
    );
    expect(rows.map((r) => r.extname)).toEqual(["pg_trgm", "vector"]);
  });

  it("повторный запуск на актуальной базе ничего не применяет", async () => {
    const before = await db.owner.query("select hash from drizzle.__drizzle_migrations");
    await runMigrations(db.owner);
    const after = await db.owner.query("select hash from drizzle.__drizzle_migrations");
    expect(after.rows).toEqual(before.rows);
    expect(after.rows.length).toBeGreaterThan(0);
  });

  it("два параллельных старта под pg_advisory_lock: применяет один, второй ждёт и не повторяет", async () => {
    // Блокировку держит тест: оба запуска встают в очередь, затем идут по одному.
    const holder = await db.owner.connect();
    try {
      await holder.query("select pg_advisory_lock($1, $2)", [...MIGRATION_LOCK]);
      const options = { folder: COUNTER_DIR, table: "__counter_migrations" };
      const first = runMigrations(db.owner, options);
      const second = runMigrations(db.owner, options);
      await vi.waitFor(async () => {
        const { rows } = await holder.query<{ waiting: number }>(
          "select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted",
        );
        expect(rows[0]?.waiting).toBe(2);
      });
      await holder.query("select pg_advisory_unlock($1, $2)", [...MIGRATION_LOCK]);
      await Promise.all([first, second]);
    } finally {
      holder.release();
    }
    const runs = await db.owner.query("select run from fx_migration_runs");
    const journal = await db.owner.query("select name from drizzle.__counter_migrations");
    expect(runs.rows).toEqual([{ run: 1 }]);
    expect(journal.rows).toEqual([{ name: "20261024000000_counter" }]);
  });
});
