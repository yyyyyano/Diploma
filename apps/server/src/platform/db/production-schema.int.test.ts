// Боевая схема: все схемы модулей (и platform) против базы из боевых миграций apps/server/drizzle. Новая таблица
// без вида, VIEW или функция в миграции, nullable household_id — красный make test (ARCHITECTURE §6.2, замок 4).
// Старт приложения (T-007) загружает схемы так же — иначе аудитор не узнает незагруженную таблицу.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProductionSchemas } from "./__fixtures__/production-schemas.ts";
import { checkSchema } from "./schema-check.ts";
import { registeredTables } from "./tables.ts";

let db: TestDb;
beforeAll(async () => {
  await loadProductionSchemas();
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
