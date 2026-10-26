// make migrate: применить боевые миграции, поставить схему очереди pgboss и выдать права роли приложения (ADR-0020)
// — под владельцем базы (MIGRATION_DATABASE_URL, MIGRATION_DB_PASSWORD_FILE — loadDbConfig, без мастер-ключа).
// Приложение делает то же при старте (compose.ts); цель нужна и для ручного запуска.
import { loadDbConfig } from "../platform/config/config.ts";
import { createPool } from "../platform/db/connection.ts";
import { appRoleOptions } from "../platform/db/roles.ts";
import { migrateDatabase } from "./migrate-database.ts";

const config = loadDbConfig();
const pool = createPool(config.migration, { max: 1, applicationName: "kosht-cli-migrate" });
try {
  await migrateDatabase(pool, appRoleOptions(config.app), config.migrationsDir);
  console.log("Миграции применены, схема очереди поставлена, права роли приложения выданы.");
} finally {
  await pool.end();
}
