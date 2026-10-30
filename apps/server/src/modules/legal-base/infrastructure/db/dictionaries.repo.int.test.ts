// LAW-40: начальные строки справочников в таблицах — умолчания кода, которые кладёт миграция (дрейф между SQL и кодом ловит этот тест).
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb, type SystemDb } from "../../../../platform/db/system-db.ts";
import { START_CATALOG } from "../../domain/start-catalog.ts";
import { DEFAULT_COLLOQUIAL_TERMS } from "../../domain/synonyms.ts";
import { DEFAULT_ORGANS } from "../../domain/topics.ts";
import { colloquialTerms, organTopics, startCatalogEntries } from "./dictionaries.repo.ts";

let db: TestDb;
let system: SystemDb;
beforeAll(async () => {
  db = await createTestDb();
  system = createSystemDb(db.pool);
});
afterAll(async () => {
  await db.drop();
});

describe("LAW-40: начальные строки справочников — умолчания кода, их кладёт миграция", () => {
  it("стартовый каталог в таблице — те же 28 актов в том же порядке, с группами витрины", async () => {
    expect(await startCatalogEntries(system)).toEqual(START_CATALOG);
  });

  it("органы и словарь «бытовое → юридическое» в таблицах совпадают с умолчаниями", async () => {
    expect(await organTopics(system)).toEqual(DEFAULT_ORGANS);
    expect(await colloquialTerms(system)).toEqual(DEFAULT_COLLOQUIAL_TERMS);
  });
});
