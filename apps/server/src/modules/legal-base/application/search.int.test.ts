// LAW-21, LAW-22, LAW-23, LAW-10 на настоящем Postgres и настоящих страницах (90-З, НК): точное обращение без векторов,
// гибридный поиск (полнотекстовый + поддельные детерминированные векторы), только действующие акты, без модели —
// реквизиты и FTS без ошибки, задача векторов ждёт модель и не падает.
import { readFileSync } from "node:fs";
import { FakeClock, hashEmbedder } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { START_CATALOG } from "../domain/start-catalog.ts";
import { seedActs, seedAliases } from "../infrastructure/db/catalog.repo.ts";
import { ActTextNotFound, type LegalSource } from "./ports.ts";
import { makeEmbedder } from "./embed.ts";
import { makeLoadAct } from "./load-act.ts";
import { legalBaseTools } from "../agent/tools.ts";
import { makeLookup } from "./lookup.ts";
import { makeLawSearch } from "./search.ts";

const page = (name: string): string =>
  readFileSync(new URL(`../__fixtures__/pravo-by/${name}`, import.meta.url), "utf8");

let db: TestDb;
const clock = new FakeClock("2026-10-30T09:00:00Z");
const log = memoryLogger();
const system = () => createSystemDb(db.pool);

beforeAll(async () => {
  db = await createTestDb();
  await seedActs(system(), START_CATALOG, "start-catalog");
  await seedAliases(system(), START_CATALOG);
  const pages: Record<string, string> = {
    H10200090: page("H10200090.html"),
    Hk0900071: page("Hk0900071.html"),
  };
  const source: LegalSource = {
    async fetchActText(id) {
      const html = pages[id];
      if (html === undefined) throw new ActTextNotFound();
      return { html, fetchedAt: clock.now() };
    },
  };
  const load = makeLoadAct({
    system: system(),
    source: async () => source,
    clock,
    log: log.log,
    notifications: { notifyAdmins: async () => undefined },
  });
  await load("H10200090");
  await load("Hk0900071");
});
afterAll(async () => {
  await db.drop();
});

const fake = hashEmbedder(1024);
const search = (embedQuery: (t: string) => Promise<readonly number[] | null>) =>
  makeLawSearch({ system: system(), embedQuery, log: log.log });
const noModel = {
  search: (query: string) =>
    search(async () => {
      throw new Error("модель не запущена");
    }).search(query),
};

describe("LAW-21 шаг 1: точное обращение без векторов", () => {
  it("«ст. 210 НК» → статья 210 Особенной части (Общая часть такой статьи не содержит)", async () => {
    const out = await noModel.search("ст. 210 НК");
    expect(out.mode).toBe("exact");
    expect(out.fragments[0]?.pathKey).toBe("a210");
    expect(out.fragments.every((f) => f.articleNo === "210")).toBe(true);
    expect(out.fragments[0]?.url).toBe("https://pravo.by/document/?guid=3871&p0=Hk0900071");
  });

  it("«ст. 216¹ НК» — надстрочный номер; «п. 3 ст. 13 Закона о защите прав потребителей» — именно пункт 3", async () => {
    expect((await noModel.search("ст. 216¹ НК")).fragments[0]?.pathKey).toBe("a216.1");
    const out = await noModel.search("п. 3 ст. 13 Закона о защите прав потребителей");
    expect(out.mode).toBe("exact");
    expect(out.fragments.map((f) => f.pathKey)).toEqual(["a13/p3"]);
  });

  it("исключённая статья возвращается со статусом «исключена»", async () => {
    const out = await noModel.search("ст. 113 НК");
    expect(out.fragments[0]).toMatchObject({ pathKey: "a113", excluded: true });
  });

  it("нет такой статьи — обращение не находится и вопрос идёт в обычный поиск", async () => {
    expect((await noModel.search("ст. 99999 НК")).mode).toBe("hybrid");
  });
});

describe("LAW-21 шаг 2, LAW-10: гибридный поиск", () => {
  it("без модели поиск идёт по полнотекстовому индексу без ошибки, ключ лога law.search.no-vectors", async () => {
    const out = await noModel.search("обмен товара надлежащего качества потребитель");
    expect(out.mode).toBe("hybrid");
    expect(out.vectors).toBe(false);
    expect(out.fragments.length).toBeGreaterThan(0);
    expect(out.fragments.length).toBeLessThanOrEqual(10);
    expect(out.fragments.some((f) => f.pravoId === "H10200090")).toBe(true);
    expect(log.text()).toContain("law.search.no-vectors");
  });

  it("словарь «бытовое → юридическое»: «вычет» находит налоговые вычеты НК", async () => {
    const out = await noModel.search("какой вычет мне положен на ребёнка");
    expect(
      out.fragments.some((f) => f.path.includes("Статья 209") || f.path.includes("Статья 210")),
    ).toBe(true);
  });

  it("после векторизации в выдаче работают и векторы (поддельные детерминированные), 6–10 фрагментов не превышаются", async () => {
    const embedder = makeEmbedder({
      system: system(),
      embed: (texts) => fake.embed(texts),
      clock,
      log: log.log,
    });
    const done = await embedder.run();
    expect(done.state).toBe("idle");
    expect(done.embedded).toBe(done.total);
    const withVectors = search(async (text) => (await fake.embed([text]))[0] ?? null);
    const out = await withVectors.search("обмен товара надлежащего качества потребитель");
    expect(out.vectors).toBe(true);
    expect(out.fragments.length).toBeLessThanOrEqual(10);
    expect(out.fragments.some((f) => f.pravoId === "H10200090")).toBe(true);
  });

  it("акт, утративший силу, из поиска и точного обращения выходит", async () => {
    await db.owner.query("update legal_acts set status = 'repealed' where pravo_id = 'Hk0900071'");
    try {
      expect((await noModel.search("ст. 210 НК")).mode).toBe("hybrid");
      const out = await noModel.search("налоговые вычеты подоходный налог");
      expect(out.fragments.every((f) => f.pravoId !== "Hk0900071")).toBe(true);
    } finally {
      await db.owner.query("update legal_acts set status = 'active' where pravo_id = 'Hk0900071'");
    }
  });
});

describe("LAW-23: векторы фоном", () => {
  it("без модели задача не падает: «ждём модель», векторы не пишутся и не уходят в повтор", async () => {
    await db.owner.query("truncate legal_fragment_embeddings");
    const embedder = makeEmbedder({
      system: system(),
      embed: async () => {
        throw new Error("модель не запущена");
      },
      clock,
      log: log.log,
    });
    const out = await embedder.run();
    expect(out.state).toBe("waiting-model");
    expect(out.embedded).toBe(0);
    expect((await embedder.progress(false)).state).toBe("waiting-model");
  });

  it("у вектора имя и версия модели; смена активной модели заново векторизует только действующие версии", async () => {
    const make = () =>
      makeEmbedder({ system: system(), embed: (t) => fake.embed(t), clock, log: log.log });
    await make().run();
    const rows = await db.owner.query<{ name: string; version: string; n: string }>(
      "select m.name, m.version, count(*) as n from legal_fragment_embeddings e join legal_embedding_models m on m.id = e.model_id group by 1, 2",
    );
    expect(rows.rows.map((r) => [r.name, r.version])).toEqual([["bge-m3", "1"]]);
    // Смена модели: новая активная — вектора нет ни у одной версии, ждёт переиндексации.
    await db.owner.query("update legal_embedding_models set active = false");
    await db.owner.query(
      "insert into legal_embedding_models (name, version, dimensions, active) values ('bge-m3', '2', 1024, true)",
    );
    const before = await make().progress(true);
    expect(before.embedded).toBe(0);
    const after = await make().run();
    expect(after.embedded).toBe(after.total);
  });
});

describe("инструменты агента search_law, get_law_fragment, law_act_card (набор legal, чтение)", () => {
  const tools = () =>
    legalBaseTools({
      search: search(async () => null),
      lookup: makeLookup({ system: system() }),
    });
  const ctx = {} as never;

  it("описаны как чтение набора legal", () => {
    const list = Object.values(tools());
    expect(list.map((t) => [t.name, t.toolset, t.kind])).toEqual([
      ["search_law", "legal", "read"],
      ["get_law_fragment", "legal", "read"],
      ["law_act_card", "legal", "read"],
    ]);
  });

  it("search_law → фрагменты со ссылкой; get_law_fragment по их id возвращает тот же текст", async () => {
    const t = tools();
    const found = await t.search.execute(ctx, { query: "ст. 210 НК" });
    expect(found.mode).toBe("exact");
    const first = found.fragments[0];
    expect(first?.url).toContain("pravo.by/document/?guid=3871");
    const again = await t.fragment.execute(ctx, { id: first?.id ?? "" });
    expect(again.fragment?.text).toBe(first?.text);
  });

  it("law_act_card: акт только с карточкой — без текста, неизвестный — null", async () => {
    const t = tools();
    const card = await t.actCard.execute(ctx, { actId: "C20200778" });
    expect(card.act).toMatchObject({ hasText: false, status: "active" });
    expect(card.act?.url).toContain("guid=3961");
    expect((await t.actCard.execute(ctx, { actId: "H99999999" })).act).toBeNull();
  });
});
