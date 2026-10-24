// make migrate: применить боевые миграции к базе из окружения (DATABASE_URL, DB_PASSWORD_FILE).
// Приложение делает то же при старте (T-005); цель нужна, пока точек входа нет, и для ручного запуска.
import { createPool, dbConfigFromEnv } from "./connection.ts";
import { runMigrations } from "./migrate.ts";

const pool = createPool(dbConfigFromEnv(), { max: 1 });
try {
  await runMigrations(pool);
  console.log("Миграции применены.");
} finally {
  await pool.end();
}
