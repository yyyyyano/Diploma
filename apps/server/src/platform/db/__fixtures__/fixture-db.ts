// Тестовая схема механизма изоляции в базе тестового файла: её миграции (drizzle/ рядом) применяются поверх
// клона боевого шаблона тем же runMigrations, со своим журналом — в apps/server/drizzle они не попадают.
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { runMigrations } from "../migrate.ts";

export const FIXTURE_MIGRATIONS_DIR = fileURLToPath(new URL("drizzle", import.meta.url));

export async function migrateFixtures(pool: pg.Pool): Promise<void> {
  await runMigrations(pool, { folder: FIXTURE_MIGRATIONS_DIR, table: "__fixture_migrations" });
}
