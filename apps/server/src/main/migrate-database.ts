// Подготовка базы владельцем (ADR-0007, ADR-0008, ADR-0020) — одна последовательность для старта процесса
// (compose.ts), make migrate (migrate-cli.ts) и сборки тестового шаблона (int-global-setup.ts): миграции Drizzle →
// схема очереди pgboss → права роли приложения на все APP_SCHEMAS. Порядок важен: GRANT … ON ALL TABLES выдаёт
// права только на уже созданные таблицы, а установщик pg-boss создаёт свои — значит, права выдаются последними.
import { bossDb } from "../platform/db/boss-db.ts";
import type { createPool } from "../platform/db/connection.ts";
import { runMigrations, withMigrationLock } from "../platform/db/migrate.ts";
import { ensureAppRole, type AppRoleOptions } from "../platform/db/roles.ts";
import { installJobsSchema } from "../platform/jobs/install.ts";

/** Пул владельца базы (MIGRATION_*): закрывает его вызывающий. */
export type OwnerPool = ReturnType<typeof createPool>;

export async function migrateDatabase(owner: OwnerPool, appRole: AppRoleOptions): Promise<void> {
  await runMigrations(owner);
  await withMigrationLock(owner, (client) => installJobsSchema(bossDb(client)));
  await ensureAppRole(owner, appRole);
}
