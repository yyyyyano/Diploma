// make migrate: применить боевые миграции к базе из окружения (DATABASE_URL, DB_PASSWORD_FILE — loadDbConfig, без
// мастер-ключа). Приложение делает то же при старте (T-059); цель нужна и для ручного запуска.
import { loadDbConfig } from "../config/config.ts";
import { createPool } from "./connection.ts";
import { runMigrations } from "./migrate.ts";

const pool = createPool(loadDbConfig(), { max: 1 });
try {
  await runMigrations(pool);
  console.log("Миграции применены.");
} finally {
  await pool.end();
}
