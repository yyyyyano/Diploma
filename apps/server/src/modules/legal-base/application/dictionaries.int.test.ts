// LAW-40: семь справочников администратора на настоящем Postgres — три в таблицах (начальные строки кладёт миграция), три в
// настройках, краткие имена — в таблице алиасов.
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb, type SystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { createSettings } from "../../../platform/settings/settings.ts";
import { START_CATALOG } from "../domain/start-catalog.ts";
import { DEFAULT_ORGANS } from "../domain/topics.ts";
import { seedActs, seedAliases } from "../infrastructure/db/catalog.repo.ts";
import { colloquialTerms } from "../infrastructure/db/dictionaries.repo.ts";
import { actsByAlias } from "../infrastructure/db/search.repo.ts";
import { makeDictionaries } from "./dictionaries.ts";

let db: TestDb;
let system: SystemDb;
beforeAll(async () => {
  db = await createTestDb();
  system = createSystemDb(db.pool);
});
afterAll(async () => {
  await db.drop();
});

function dictionaries() {
  const settings = createSettings({
    db: system,
    clock: new FakeClock("2026-10-31T09:00:00Z"),
    env: () => undefined,
    log: memoryLogger().log,
  });
  return makeDictionaries({ system, settings });
}

describe("LAW-40: стартовый каталог", () => {
  it("новый акт появляется в списке и сразу заводится в каталог актов (карточкой, если текста нет)", async () => {
    const dict = dictionaries();
    const view = await dict.upsert("start-catalog", null, {
      pravoId: "H19900001",
      title: "Закон «О тестах»",
      label: "Закон о тестах",
      kind: "law",
      hasText: "card",
      group: "consumer",
    });
    expect(view.rows.find((r) => r.id === "H19900001")?.values).toMatchObject({
      label: "Закон о тестах",
      hasText: "card",
      group: "consumer",
    });
    const { rows } = await db.owner.query<{ load_state: string; source: string; topic: string }>(
      "select load_state, source, topic from legal_acts where pravo_id = 'H19900001'",
    );
    expect(rows).toEqual([{ load_state: "card-only", source: "start-catalog", topic: "consumer" }]);
  });

  it("правка ключа переносит строку, занятый ключ — VALIDATION «duplicate», удаление несуществующей — NOT_FOUND", async () => {
    const dict = dictionaries();
    const edited = {
      pravoId: "H19900002",
      title: "Закон «О тестах»",
      label: "Закон о тестах",
      kind: "law",
      hasText: "text",
      group: "",
    };
    const moved = await dict.upsert("start-catalog", "H19900001", edited);
    expect(moved.rows.map((r) => r.id)).toContain("H19900002");
    expect(moved.rows.map((r) => r.id)).not.toContain("H19900001");
    // Порядок строки при переносе сохраняется: она осталась последней, а не прыгнула в начало.
    expect(moved.rows.at(-1)?.id).toBe("H19900002");

    await expect(
      dict.upsert("start-catalog", null, { ...edited, pravoId: "Hk0200166" }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      params: { field: "pravoId", reason: "duplicate" },
    });
    await expect(dict.upsert("start-catalog", "нет такого", edited)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const removed = await dict.remove("start-catalog", "H19900002");
    expect(removed.rows.map((r) => r.id)).not.toContain("H19900002");
    await expect(dict.remove("start-catalog", "H19900002")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("LAW-40: справочники в настройках модуля", () => {
  it("рубрика ЕПК → тема: добавить, переименовать ключ, удалить; значение живёт между вызовами", async () => {
    const dict = dictionaries();
    await dict.upsert("epk-topics", null, { rubric: "12.34", topic: "family" });
    const renamed = await dict.upsert("epk-topics", "12.34", { rubric: "12.35", topic: "fines" });
    expect(renamed.rows.find((r) => r.id === "12.35")?.values).toEqual({
      rubric: "12.35",
      topic: "fines",
    });
    expect(renamed.rows.some((r) => r.id === "12.34")).toBe(false);
    // Новый экземпляр настроек (как другой процесс) видит запись: она в базе, а не в памяти.
    expect((await dictionaries().list("epk-topics")).rows.some((r) => r.id === "12.35")).toBe(true);
    const after = await dict.remove("epk-topics", "12.35");
    expect(after.rows.some((r) => r.id === "12.35")).toBe(false);
  });

  it("шаблоны заголовков и ведомственные страницы: список строк, повтор — «duplicate»", async () => {
    const dict = dictionaries();
    const patterns = await dict.upsert("title-patterns", null, { pattern: "^О премировании" });
    expect(patterns.rows.at(-1)?.id).toBe("^О премировании");
    await expect(
      dict.upsert("title-patterns", null, { pattern: "^О премировании" }),
    ).rejects.toMatchObject({ params: { reason: "duplicate" } });
    const pages = await dict.upsert("agency-pages", null, { url: "https://www.nbrb.by/news" });
    expect(pages.rows.map((r) => r.id)).toEqual(["https://www.nbrb.by/news"]);
    expect((await dict.remove("agency-pages", "https://www.nbrb.by/news")).rows).toEqual([]);
  });
});

describe("LAW-40: органы и «бытовое → юридическое» в таблицах", () => {
  it("новый орган добавляется в конец — первое совпадение по порядку не меняется; шаблон с ошибкой не принимается", async () => {
    const dict = dictionaries();
    const view = await dict.upsert("organs", null, {
      pattern: "статистическ\\p{L}*\\s+комитет",
      topic: "taxes",
    });
    expect(view.rows.at(-1)?.id).toBe("статистическ\\p{L}*\\s+комитет");
    expect(view.rows[0]?.id).toBe(DEFAULT_ORGANS[0]?.pattern);
    await expect(
      dict.upsert("organs", null, { pattern: "(", topic: "taxes" }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("слово словаря нормализуется, термины читаются поиском из таблицы", async () => {
    const dict = dictionaries();
    await dict.upsert("colloquial", null, {
      word: "Премия",
      terms: "премирование; поощрительная выплата",
    });
    expect((await colloquialTerms(system))["премия"]).toEqual([
      "премирование",
      "поощрительная выплата",
    ]);
    await dict.remove("colloquial", "премия");
    expect((await colloquialTerms(system))["премия"]).toBeUndefined();
  });
});

describe("LAW-40: краткие имена актов", () => {
  it("имя за актом каталога работает как точное обращение; акта нет в каталоге — «unknown-act»", async () => {
    await seedActs(system, START_CATALOG, "start-catalog");
    await seedAliases(system, START_CATALOG);
    const dict = dictionaries();
    const view = await dict.upsert("aliases", null, {
      pravoId: "Hk0900071",
      alias: "Налоговый кодекс РБ",
    });
    expect(view.rows.some((r) => r.id === "Hk0900071|налоговый кодекс рб")).toBe(true);
    expect((await actsByAlias(system, "налоговый кодекс рб")).map((a) => a.pravoId)).toEqual([
      "Hk0900071",
    ]);

    await expect(
      dict.upsert("aliases", null, { pravoId: "H19999999", alias: "призрак" }),
    ).rejects.toMatchObject({ params: { reason: "unknown-act" } });

    const removed = await dict.remove("aliases", "Hk0900071|налоговый кодекс рб");
    expect(removed.rows.some((r) => r.id === "Hk0900071|налоговый кодекс рб")).toBe(false);
    expect(await actsByAlias(system, "налоговый кодекс рб")).toEqual([]);
  });
});
