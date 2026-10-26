// Шаблонная база тестов (ARCHITECTURE §12): боевые миграции, схема очереди pgboss и права роли приложения — одна
// на отпечаток (папка apps/server/drizzle, версия pg-boss, текст выдачи прав); тестовые базы клонируют её
// (createTestDb из @kosht/testing/db). Здесь, а не в @kosht/testing: пакет тестов не импортирует сервер, а миграции —
// его. Шаблон собирает владелец (MIGRATION_*), тесты работают ролью приложения (DATABASE_URL), как приложение
// (ADR-0020). Зовут globalSetup проекта int (int-global-setup.ts) и стенд e2e (entrypoints/__fixtures__/e2e-stack.ts).
import {
  dropOrphans,
  fingerprintDir,
  prepareTemplate,
  type TestDbConnection,
  type TestDbContext,
} from "@kosht/testing/db";
import { createHash } from "node:crypto";
import pg from "pg";
import { loadDbConfig, type DbConfig } from "../../config/config.ts";
import { connectionOptions, createPool } from "../connection.ts";
import { migrateDatabase } from "../../../main/migrate-database.ts";
import { PG_BOSS_VERSION } from "../../jobs/install.ts";
import { appRoleGrants, appRoleOptions } from "../roles.ts";

function connectionOf(config: DbConfig): TestDbConnection {
  const { host, port, user, password, database } = connectionOptions(config);
  if (
    host === undefined ||
    port === undefined ||
    user === undefined ||
    typeof password !== "string"
  ) {
    throw new Error("int-global-setup: неполные параметры подключения к БД (DATABASE_URL).");
  }
  return { host, port, user, password, database: database ?? "kosht" };
}

/**
 * Роль приложения входит с паролем из файла: роль и её пароль живут в кластере, а не в шаблоне. Новый файл пароля
 * или чужая правка роли — шаблон собирается заново, и ensureAppRole приводит роль в порядок.
 */
async function appCanLogin(app: TestDbConnection): Promise<boolean> {
  const client = new pg.Client(app);
  try {
    await client.connect();
  } catch (error) {
    // 28P01 — неверный пароль, 28000 — роли нет; прочее (база не запущена) — наружу.
    const code = (error as { code?: string }).code;
    if (code === "28P01" || code === "28000") return false;
    throw error;
  }
  await client.end();
  return true;
}

export async function prepareServerTemplate(): Promise<TestDbContext> {
  const config = loadDbConfig();
  const admin = connectionOf(config.migration);
  const app = connectionOf(config.app);
  const role = appRoleOptions(config.app);
  await dropOrphans(admin);
  const fingerprint = createHash("sha256")
    .update(fingerprintDir(config.migrationsDir))
    // Схему pgboss ставит установщик pg-boss: новая версия — новая схема, значит и новый шаблон.
    .update(`pg-boss@${PG_BOSS_VERSION}`)
    .update(appRoleGrants({ ...role, owner: admin.user }).join("\n"))
    .digest("hex")
    .slice(0, 16);
  const template = await prepareTemplate(
    admin,
    fingerprint,
    async (name) => {
      const pool = createPool(config.migration, { database: name, max: 1 });
      try {
        await migrateDatabase(pool, role, config.migrationsDir);
      } finally {
        await pool.end();
      }
    },
    { rebuild: !(await appCanLogin(app)) },
  );
  return { admin, app, template, runId: String(process.pid) };
}
