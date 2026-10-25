// Схема очереди pgboss (ADR-0008, ADR-0020): ставит и мигрирует её владелец базы — до выдачи прав роли
// приложения и под той же блокировкой миграций (main/migrate-database.ts), потому что роль приложения не может
// создавать таблицы. Процессы приложения запускают pg-boss с migrate: false — он только сверяет версию схемы.
import { createRequire } from "node:module";
import { PgBoss } from "pg-boss";
import type { BossDb } from "../db/boss-db.ts";

/** Схема таблиц pg-boss; её же получает роль приложения в APP_SCHEMAS (platform/db/roles.ts). */
export const JOBS_SCHEMA = "pgboss";

/**
 * Версия установленного pg-boss: входит в отпечаток тестового шаблона — новая версия с новой схемой собирает
 * новый шаблон.
 */
export const PG_BOSS_VERSION: string = (
  createRequire(import.meta.url)("pg-boss/package.json") as { version: string }
).version;

/**
 * Установить или обновить схему pgboss на соединении владельца. pg-boss сам решает, ставить схему или мигрировать
 * (таблица pgboss.version), и сам переживает гонку двух установщиков. Ни обработчиков, ни расписаний, ни
 * обслуживания: экземпляр живёт только на время установки и закрывается, не трогая соединение (close: false).
 */
export async function installJobsSchema(db: BossDb): Promise<void> {
  const boss = new PgBoss({
    db,
    schema: JOBS_SCHEMA,
    migrate: true,
    supervise: false,
    schedule: false,
    registerInstance: false,
  });
  await boss.start();
  await boss.stop({ graceful: false, close: false });
}
