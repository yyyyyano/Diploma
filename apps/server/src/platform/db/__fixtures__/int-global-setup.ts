// globalSetup проекта int (vitest.config.ts): шаблонная база из боевых миграций с правами роли приложения — одна на
// отпечаток (папка apps/server/drizzle + текст выдачи прав); тестовые файлы клонируют её (createTestDb из
// @kosht/testing/db). Здесь, а не в @kosht/testing: пакет тестов не импортирует сервер, а миграции — его
// (ARCHITECTURE §12). Шаблон собирает владелец (MIGRATION_*), тесты работают ролью приложения (DATABASE_URL), как
// приложение (ADR-0020).
import {
  dropOrphans,
  fingerprintDir,
  prepareTemplate,
  type TestDbConnection,
} from "@kosht/testing/db";
import { createHash } from "node:crypto";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { loadDbConfig, type DbConfig } from "../../config/config.ts";
import { connectionOptions, createPool } from "../connection.ts";
import { MIGRATIONS_DIR, runMigrations } from "../migrate.ts";
import { appRoleGrants, appRoleOptions, ensureAppRole } from "../roles.ts";

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

export default async function setup(project: TestProject): Promise<void> {
  const config = loadDbConfig();
  const admin = connectionOf(config.migration);
  const app = connectionOf(config.app);
  const role = appRoleOptions(config.app);
  await dropOrphans(admin);
  const fingerprint = createHash("sha256")
    .update(fingerprintDir(MIGRATIONS_DIR))
    .update(appRoleGrants({ ...role, owner: admin.user }).join("\n"))
    .digest("hex")
    .slice(0, 16);
  const template = await prepareTemplate(
    admin,
    fingerprint,
    async (name) => {
      const pool = createPool(config.migration, { database: name, max: 1 });
      try {
        await runMigrations(pool);
        await ensureAppRole(pool, role);
      } finally {
        await pool.end();
      }
    },
    { rebuild: !(await appCanLogin(app)) },
  );
  project.provide("testDb", { admin, app, template, runId: String(process.pid) });
}
