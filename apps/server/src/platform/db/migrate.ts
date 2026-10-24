// Миграции применяет само приложение при старте (ADR-0007, ADR-0015) — одинаково в make dev и make up. Несколько
// процессов (api, worker, bot) стартуют одновременно: миграции идут под pg_advisory_lock на отдельном соединении
// из пула — первый применяет, остальные ждут и, получив блокировку, видят, что применять нечего.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import type pg from "pg";

/** Боевые миграции: apps/server/drizzle (папка на миграцию: <время>_<имя>/migration.sql). */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../../drizzle", import.meta.url));

/** Ключ блокировки миграций: пара чисел, «KOSH» и 1 — не пересекается с блокировками pg-boss и бота. */
export const MIGRATION_LOCK = [0x4b4f5348, 1] as const;

export interface MigrateOptions {
  /** Папка миграций; по умолчанию — боевая. */
  readonly folder?: string;
  /** Журнал применённых миграций в схеме drizzle; у тестовой схемы — свой. */
  readonly table?: string;
}

/** Применить недостающие миграции; одна транзакция на весь набор, под блокировкой. */
export async function runMigrations(pool: pg.Pool, options: MigrateOptions = {}): Promise<void> {
  const client = await pool.connect();
  let broken: unknown;
  try {
    await client.query("select pg_advisory_lock($1, $2)", [...MIGRATION_LOCK]);
    try {
      await migrate(drizzle({ client }), {
        migrationsFolder: options.folder ?? MIGRATIONS_DIR,
        migrationsTable: options.table ?? "__drizzle_migrations",
      });
    } finally {
      await client.query("select pg_advisory_unlock($1, $2)", [...MIGRATION_LOCK]);
    }
  } catch (error) {
    broken = error;
    throw error;
  } finally {
    // Соединение после ошибки не возвращается в пул: на нём могла остаться блокировка.
    client.release(broken !== undefined);
  }
}
