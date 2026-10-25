// CONSTRAINTS «Префикс агента ≤ 3 000 токенов», ARCHITECTURE §8.2: системная подсказка и описания инструментов набора
// core из настоящего реестра модулей, посчитанные токенизатором o200k_base. Новый инструмент core, раздувший
// префикс, — красный тест.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { agentPrefix } from "../modules/agent/index.ts";
import { loadConfig } from "../platform/config/config.ts";
import { memoryLogger } from "../platform/logging/__fixtures__/memory-logger.ts";
import { compose, type Composition } from "./compose.ts";

const PREFIX_TOKEN_BUDGET = 3_000;

let db: TestDb;
let dir: string;
let api: Composition;

beforeAll(async () => {
  db = await createTestDb();
  dir = await mkdtemp(join(tmpdir(), "kosht-prefix-"));
  const { app, admin } = inject("testDb");
  await writeFile(join(dir, "db_app_password"), app.password, { mode: 0o600 });
  await writeFile(join(dir, "db_password"), admin.password, { mode: 0o600 });
  await writeFile(join(dir, "master.key"), randomBytes(32), { mode: 0o600 });
  api = await compose(
    loadConfig({
      DATABASE_URL: `postgres://${app.user}@${app.host}:${String(app.port)}/${db.name}`,
      DB_PASSWORD_FILE: join(dir, "db_app_password"),
      MIGRATION_DATABASE_URL: `postgres://${admin.user}@${admin.host}:${String(admin.port)}/${db.name}`,
      MIGRATION_DB_PASSWORD_FILE: join(dir, "db_password"),
      MASTER_KEY_FILE: join(dir, "master.key"),
      DATA_DIR: join(dir, "data"),
    }),
    "api",
    { log: memoryLogger().log },
  );
});

afterAll(async () => {
  await api.close();
  await db.drop();
  await rm(dir, { recursive: true, force: true });
});

describe("ARCHITECTURE §8.2: префикс агента", () => {
  it(`подсказка и инструменты core — не больше ${String(PREFIX_TOKEN_BUDGET)} токенов o200k_base`, () => {
    const prefix = agentPrefix([...api.registries.tools.values()]);
    expect(prefix).toContain("list_accounts");
    expect(countTokens(prefix)).toBeLessThanOrEqual(PREFIX_TOKEN_BUDGET);
  });
});
