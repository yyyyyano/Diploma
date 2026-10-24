// Боевая схема: все схемы модулей (и platform) против базы из боевых миграций apps/server/drizzle. Новая таблица
// без вида, VIEW или функция в миграции, nullable household_id — красный make test (ARCHITECTURE §6.2, замок 4).
// Старт приложения (T-007) загружает схемы так же — иначе аудитор не узнает незагруженную таблицу.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkSchema } from "./schema-check.ts";
import { registeredTables } from "./tables.ts";

const SERVER_SRC = fileURLToPath(new URL("../../", import.meta.url));
/** Где лежат схемы (ARCHITECTURE §4.1): infrastructure/db/schema.ts или папка schema/ модуля. */
const SCHEMA_GLOBS = [
  "modules/*/infrastructure/db/schema.ts",
  "modules/*/infrastructure/db/schema/*.ts",
  "platform/*/schema.ts",
];

let db: TestDb;
beforeAll(async () => {
  for (const file of globSync(SCHEMA_GLOBS, { cwd: SERVER_SRC })) {
    if (!file.endsWith(".test.ts")) await import(new URL(file, `file://${SERVER_SRC}`).href);
  }
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("ROLE-01: боевая схема без обходов аудитора", () => {
  it("каждая таблица public — в реестре, без VIEW, функций и триггеров, household_id не NULL", async () => {
    expect(await checkSchema(db.pool, registeredTables())).toEqual([]);
  });
});
