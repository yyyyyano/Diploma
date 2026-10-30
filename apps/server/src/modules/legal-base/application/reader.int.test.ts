// LEGAL-11, LEGAL-05, LEGAL-06, LAW-07, LAW-32 на Postgres и настоящих страницах (90-З, НК, ПСМ № 569): каталог для всех,
// акт с оглавлением по структуре, текст по частям, «ст. 210 НК» → статья, принятые изменения, акт «только карточка».
import { readFileSync } from "node:fs";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { START_CATALOG } from "../domain/start-catalog.ts";
import { seedActs, seedAliases } from "../infrastructure/db/catalog.repo.ts";
import { syncPendingChanges } from "../infrastructure/db/changes.repo.ts";
import { makeLoadAct } from "./load-act.ts";
import { PAGE_SIZE, makeReader } from "./reader.ts";
import { ActTextNotFound, type LegalSource } from "./ports.ts";

const page = (name: string): string =>
  readFileSync(new URL(`../__fixtures__/pravo-by/${name}`, import.meta.url), "utf8");

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

async function setup() {
  const system = createSystemDb(db.pool);
  const clock = new FakeClock("2026-10-30T09:00:00Z");
  await seedActs(system, START_CATALOG, "start-catalog");
  await seedAliases(system, START_CATALOG);
  const pages: Record<string, string> = {
    H10200090: page("H10200090.html"),
    Hk0900071: page("Hk0900071.html"),
    C21300569: page("C21300569.html"),
  };
  const source: LegalSource = {
    async fetchActText(id) {
      const html = pages[id];
      if (html === undefined) throw new ActTextNotFound();
      return { html, fetchedAt: clock.now() };
    },
  };
  const load = makeLoadAct({
    system,
    source: async () => source,
    clock,
    log: memoryLogger().log,
    notifications: { notifyAdmins: async () => undefined } as never,
  });
  for (const id of Object.keys(pages)) await load(id);
  return { system, reader: makeReader({ system }) };
}

describe("LEGAL-11, LAW-07: каталог для всех", () => {
  it("все 28 актов стартового каталога с состоянием, группой и днём редакции; счётчики сходятся", async () => {
    const { reader } = await setup();
    const catalog = await reader.catalog();
    expect(catalog.counts).toMatchObject({ total: 28, withText: 23, cardOnly: 5 });
    const zozpp = catalog.acts.find((a) => a.pravoId === "H10200090");
    expect(zozpp).toMatchObject({
      status: "active",
      group: "consumer",
      shortName: "Закон о защите прав потребителей",
      editionOn: "2026-10-30",
      hasText: true,
    });
    expect(catalog.acts.find((a) => a.pravoId === "H12100099")).toMatchObject({ group: "privacy" });
    expect(catalog.acts.find((a) => a.pravoId === "S21000004")).toMatchObject({
      group: "plenum",
      isNpa: false,
    });
    expect(catalog.editionOn).toBe("2026-10-30");
  });

  it("акт без текста — «только карточка» (LEGAL-06), без оглавления и со ссылкой на pravo.by", async () => {
    const { reader } = await setup();
    const view = await reader.act("C20200778");
    expect(view.act).toMatchObject({ status: "card-only", hasText: false, editionOn: null });
    expect(view.toc).toEqual([]);
    expect(view.url).toBe("https://pravo.by/document/?guid=3871&p0=C20200778");
    expect(view.cardUrl).toContain("guid=3961");
  });

  it("принятые, но не вошедшие изменения (LAW-32): статус «есть изменения» и предупреждение в карточке акта", async () => {
    const { reader, system } = await setup();
    const row = await db.owner.query<{ id: string }>(
      "select id from legal_acts where pravo_id = 'Hk0900071'",
    );
    await syncPendingChanges(
      system,
      row.rows[0]?.id ?? "",
      [
        {
          key: "170-з|2026-07-17",
          description: "Закон Республики Беларусь от 17 июля 2026 г. № 170-З",
        },
      ],
      new Set(),
      new Date("2026-10-30T09:00:00Z"),
    );
    const view = await reader.act("Hk0900071");
    expect(view.act.status).toBe("has-changes");
    expect(view.pending).toEqual([
      {
        description: "Закон Республики Беларусь от 17 июля 2026 г. № 170-З",
        inForceOn: null,
        articles: [],
      },
    ]);
    expect((await reader.catalog()).counts.withChanges).toBe(1);
  });
});

describe("LEGAL-05: читалка — оглавление и текст по частям", () => {
  it("90-З: оглавление по статьям с заголовками, статья отдаётся своими фрагментами; весь акт одним запросом не уходит", async () => {
    const { reader } = await setup();
    const view = await reader.act("H10200090");
    expect(view.toc.length).toBeGreaterThanOrEqual(51);
    expect(view.toc[0]).toMatchObject({ kind: "article" });
    const thirteen = view.toc.find((e) => e.key === "13");
    expect(thirteen?.heading).toBeTruthy();
    const text = await reader.fragments("H10200090", "13");
    expect(text.length).toBeGreaterThan(0);
    expect(text.map((f) => f.text).join("\n")).toContain("Статья 13");
    expect(text.length).toBeLessThan(view.toc.length);
  });

  it("НК: статьи сгруппированы по разделу и главе над статьёй; ст. 216¹ имеет ключ 216.1", async () => {
    const { reader } = await setup();
    const view = await reader.act("Hk0900071");
    const art = view.toc.find((e) => e.key === "210");
    expect(art?.group.length).toBeGreaterThan(0);
    expect(art?.group.join(" ")).toMatch(/Глава/u);
    expect(view.toc.some((e) => e.key.includes("."))).toBe(true);
  });

  it("ПСМ без статей: оглавление — страницы по 40 фрагментов, страница читается отдельно", async () => {
    const { reader } = await setup();
    const view = await reader.act("C21300569");
    expect(view.toc.every((e) => e.kind === "page")).toBe(true);
    expect(view.toc[0]).toMatchObject({ key: "p:1", number: "1" });
    const first = await reader.fragments("C21300569", "p:1");
    expect(first.length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(first.length).toBeGreaterThan(0);
  });

  it("несуществующий акт или статья — NOT_FOUND", async () => {
    const { reader } = await setup();
    await expect(reader.act("H99999999")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reader.fragments("H10200090", "9999")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("LEGAL-11: поиск по статье", () => {
  it.each([
    ["ст. 210 НК", { pravoId: "Hk0900071", key: "210" }],
    ["Статья 13 Закона о защите прав потребителей", { pravoId: "H10200090", key: "13" }],
    ["ст. 216¹ НК", { pravoId: "Hk0900071", key: "216.1" }],
  ])("«%s» находит статью", async (q, target) => {
    const { reader } = await setup();
    expect(await reader.resolve(q)).toEqual(target);
  });

  it("не по форме или такой статьи нет — null: интерфейс ищет по названию", async () => {
    const { reader } = await setup();
    expect(await reader.resolve("пособия")).toBeNull();
    expect(await reader.resolve("ст. 99999 НК")).toBeNull();
  });
});
