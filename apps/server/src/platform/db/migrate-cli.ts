// make migrate: применить боевые миграции и выдать права роли приложения (ADR-0020) — под владельцем базы
// (MIGRATION_DATABASE_URL, MIGRATION_DB_PASSWORD_FILE — loadDbConfig, без мастер-ключа). Приложение делает то же
// при старте (T-059); цель нужна и для ручного запуска.
import { loadDbConfig } from "../config/config.ts";
import { createPool } from "./connection.ts";
import { runMigrations } from "./migrate.ts";
import { appRoleOptions, ensureAppRole } from "./roles.ts";

const config = loadDbConfig();
const pool = createPool(config.migration, { max: 1, applicationName: "kosht-cli-migrate" });
try {
  await runMigrations(pool);
  await ensureAppRole(pool, appRoleOptions(config.app));
  console.log("Миграции применены, права роли приложения выданы.");
} finally {
  await pool.end();
}
