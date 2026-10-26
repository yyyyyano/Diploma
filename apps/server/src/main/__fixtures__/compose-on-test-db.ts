// Корень композиции на тестовой базе файла (createTestDb): временные файлы паролей и мастер-ключа, своя DATA_DIR,
// дополнительные переменные окружения (настройки с env, например LLM_MODE). close() закрывает композицию и папку.
import type { TestDb } from "@kosht/testing/db";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inject } from "vitest";
import { loadConfig } from "../../platform/config/config.ts";
import { memoryLogger } from "../../platform/logging/__fixtures__/memory-logger.ts";
import { compose, type Composition, type ProcessRole } from "../compose.ts";

export interface TestComposition {
  readonly composition: Composition;
  close(): Promise<void>;
}

export async function composeOnTestDb(
  db: TestDb,
  role: ProcessRole,
  env: Readonly<Record<string, string>> = {},
): Promise<TestComposition> {
  const dir = await mkdtemp(join(tmpdir(), "kosht-compose-"));
  const { app, admin } = inject("testDb");
  await writeFile(join(dir, "db_app_password"), app.password, { mode: 0o600 });
  await writeFile(join(dir, "db_password"), admin.password, { mode: 0o600 });
  await writeFile(join(dir, "master.key"), randomBytes(32), { mode: 0o600 });
  const composition = await compose(
    loadConfig({
      DATABASE_URL: `postgres://${app.user}@${app.host}:${String(app.port)}/${db.name}`,
      DB_PASSWORD_FILE: join(dir, "db_app_password"),
      MIGRATION_DATABASE_URL: `postgres://${admin.user}@${admin.host}:${String(admin.port)}/${db.name}`,
      MIGRATION_DB_PASSWORD_FILE: join(dir, "db_password"),
      MASTER_KEY_FILE: join(dir, "master.key"),
      // Тесты офлайн (NFR-11): трассы не уходят в Langfuse, даже если make init создал ключи.
      LANGFUSE_ENABLED: "false",
      DATA_DIR: join(dir, "data"),
      ...env,
    }),
    role,
    { log: memoryLogger().log },
  );
  return {
    composition,
    close: async () => {
      await composition.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
