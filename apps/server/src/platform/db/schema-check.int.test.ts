// Проверка схемы на тестовой схеме fx_*: чистая схема проходит, каждое подложенное нарушение — красное
// (ARCHITECTURE §6.2, CONSTRAINTS «Архитектурные запреты»: VIEW, функции и триггеры, таблица вне реестров,
// nullable household_id).
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProductionSchemas } from "./__fixtures__/production-schemas.ts";
import { migrateFixtures } from "./__fixtures__/fixture-db.ts";
import "./__fixtures__/schema.ts";
import { checkSchema, type SchemaProblemKind } from "./schema-check.ts";
import { publicTable, registeredTables, systemTable, userOwnedTable } from "./tables.ts";

let db: TestDb;
beforeAll(async () => {
  // База собрана из боевых миграций: их таблицы тоже должны быть в реестре, иначе «чистая схема» не чиста.
  await loadProductionSchemas();
  db = await createTestDb();
  await migrateFixtures(db.owner);
});
afterAll(async () => {
  await db.drop();
});

async function problemsOf(kind: SchemaProblemKind): Promise<string[]> {
  const problems = await checkSchema(db.owner, registeredTables());
  return problems.filter((p) => p.kind === kind).map((p) => p.object);
}

describe("проверка схемы: что аудитор SQL не видит", () => {
  it("чистая схема проходит: функции расширений vector и pg_trgm — не наши", async () => {
    expect(await checkSchema(db.owner, registeredTables())).toEqual([]);
  });

  it("VIEW над пользовательской таблицей — нарушение", async () => {
    await db.owner.query("create view fx_all_receipts as select * from fx_receipts");
    expect(await problemsOf("view")).toEqual(["fx_all_receipts"]);
  });

  it("SQL-функция над пользовательской таблицей — нарушение", async () => {
    await db.owner.query(
      "create function fx_all() returns setof fx_receipts language sql as 'select * from fx_receipts'",
    );
    expect(await problemsOf("function")).toContain("fx_all");
  });

  it("триггер на пользовательской таблице — нарушение (и его функция тоже)", async () => {
    await db.owner.query(
      "create function fx_touch() returns trigger language plpgsql as $$ begin return new; end $$",
    );
    await db.owner.query(
      "create trigger fx_touch before insert on fx_receipts for each row execute function fx_touch()",
    );
    expect(await problemsOf("trigger")).toEqual(["fx_touch ON fx_receipts"]);
    expect(await problemsOf("function")).toContain("fx_touch");
  });

  it("таблица с household_id вне реестров — нарушение", async () => {
    await db.owner.query("create table fx_stray (id uuid primary key, household_id uuid not null)");
    expect(await problemsOf("unregistered-table")).toEqual(["fx_stray"]);
  });

  it("nullable household_id — нарушение («смешанная» таблица)", async () => {
    systemTable("fx_mixed_owner", { id: uuid().primaryKey(), householdId: uuid() });
    await db.owner.query("create table fx_mixed_owner (id uuid primary key, household_id uuid)");
    expect(await problemsOf("nullable-household")).toEqual(["fx_mixed_owner"]);
  });

  it("пользовательская таблица с первичным ключом не (household_id, id) — нарушение", async () => {
    userOwnedTable("fx_bad_pk", { note: uuid() });
    await db.owner.query(
      "create table fx_bad_pk (id uuid primary key, household_id uuid not null, user_id uuid not null)",
    );
    expect(await problemsOf("owned-table-shape")).toEqual(["fx_bad_pk"]);
  });

  it("общая таблица с household_id или user_id — нарушение", async () => {
    publicTable("fx_public_owner", { id: uuid().primaryKey() });
    await db.owner.query(
      "create table fx_public_owner (id uuid primary key, user_id uuid not null)",
    );
    expect(await problemsOf("public-table-owner")).toEqual(["fx_public_owner"]);
  });

  it("таблица из схемы Drizzle без миграции — нарушение", async () => {
    systemTable("fx_not_migrated", { id: uuid().primaryKey() });
    expect(await problemsOf("missing-table")).toEqual(["fx_not_migrated"]);
  });
});
