// globalSetup проекта int (vitest.config.ts): шаблонная база из боевых миграций — одна на отпечаток папки
// apps/server/drizzle; тестовые файлы клонируют её (createTestDb из @kosht/testing/db). Здесь, а не в
// @kosht/testing: пакет тестов не импортирует сервер, а миграции — его (ARCHITECTURE §12).
import { dropOrphans, fingerprintDir, prepareTemplate } from "@kosht/testing/db";
import type { TestProject } from "vitest/node";
import { connectionOptions, createPool, dbConfigFromEnv } from "../connection.ts";
import { MIGRATIONS_DIR, runMigrations } from "../migrate.ts";

export default async function setup(project: TestProject): Promise<void> {
  const config = dbConfigFromEnv();
  const { host, port, user, password, database } = connectionOptions(config);
  if (
    host === undefined ||
    port === undefined ||
    user === undefined ||
    typeof password !== "string"
  ) {
    throw new Error("int-global-setup: неполные параметры подключения к БД (DATABASE_URL).");
  }
  const connection = { host, port, user, password, database: database ?? "kosht" };
  await dropOrphans(connection);
  const template = await prepareTemplate(
    connection,
    fingerprintDir(MIGRATIONS_DIR),
    async (name) => {
      const pool = createPool(config, { database: name, max: 1 });
      try {
        await runMigrations(pool);
      } finally {
        await pool.end();
      }
    },
  );
  project.provide("testDb", { connection, template, runId: String(process.pid) });
}
