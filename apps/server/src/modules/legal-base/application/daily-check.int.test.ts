// LAW-30…34, NFR-22 на Postgres и настоящих страницах (90-З, НК): лёгкая проверка HEAD, новая редакция и событие, векторы только
// новых версий, изменения «принято, но не вступило» с проверкой предложения модели по тексту, утрата силы, остановка загрузчика.
import { readFileSync } from "node:fs";
import { FakeClock, hashEmbedder } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { ChangeProposal } from "../domain/change-proposal.ts";
import { START_CATALOG } from "../domain/start-catalog.ts";
import { seedActs } from "../infrastructure/db/catalog.repo.ts";
import { pendingChangesOf } from "../infrastructure/db/changes.repo.ts";
import { makeActCheck } from "./act-check.ts";
import { makeDailyCheck } from "./daily-check.ts";
import { makeEmbedder } from "./embed.ts";
import { makeLoadAct } from "./load-act.ts";
import { ActTextNotFound, LoaderStopped, type LegalSource, type RegistrySource } from "./ports.ts";

const page = (name: string): string =>
  readFileSync(new URL(`../__fixtures__/pravo-by/${name}`, import.meta.url), "utf8");

/** Карточка в формате реестра: подписи `<b>` + `<div>` и перечень изменяющих актов фразами «Закон … от … № …». */
function card(opts: { repealedOn?: string; changes?: string[] }): string {
  return `<html><body><b>Название акта</b><div>Тест</div><b>Дата вступления в силу</b><div>01.01.2003</div>${
    opts.repealedOn === undefined
      ? ""
      : `<b>Дата ограничения действия</b><div>${opts.repealedOn}</div>`
  }<b>Акты, изменяющие (дополняющие) документ</b><table>${(opts.changes ?? []).map((c) => `<tr><td>${c}</td></tr>\n`).join("")}</table></body></html>`;
}

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.owner.query(
    "truncate legal_pending_changes, legal_fragment_embeddings, legal_update_log, legal_fragment_versions, legal_fragments, legal_act_snapshots, legal_acts cascade",
  );
  await seedActs(createSystemDb(db.pool), START_CATALOG, "start-catalog");
});

function setup() {
  const clock = new FakeClock("2026-10-30T09:00:00Z");
  const pages: Record<string, string> = {
    H10200090: page("H10200090.html"),
    Hk0900071: page("Hk0900071.html"),
  };
  const cards: Record<string, string> = {};
  const calls = { text: 0, head: 0, cards: [] as string[] };
  let stop = false;
  const source: LegalSource & RegistrySource = {
    async fetchActText(id) {
      calls.text += 1;
      if (stop) throw new LoaderStopped("LOADER_BLOCKED");
      const html = pages[id];
      if (html === undefined) throw new ActTextNotFound();
      return { html, fetchedAt: clock.now() };
    },
    async fetchActCard(id) {
      calls.cards.push(id);
      const html = cards[id];
      if (html === undefined) throw new ActTextNotFound();
      return { html, fetchedAt: clock.now() };
    },
    async headActText(id) {
      calls.head += 1;
      const html = pages[id];
      if (html === undefined) throw new ActTextNotFound();
      return { contentLength: Buffer.byteLength(html) };
    },
  };
  const system = createSystemDb(db.pool);
  const published: string[] = [];
  const notified: { kind: string; key: string }[] = [];
  const notifications = {
    notifyAdmins: async (i: { kind: "law-update-failed"; key: string }) => {
      notified.push({ kind: i.kind, key: i.key });
      return undefined;
    },
  } as never;
  const loadAct = makeLoadAct({
    system,
    source: async () => source,
    clock,
    log: memoryLogger().log,
    notifications,
  });
  let proposal: ChangeProposal = { articles: [], inForceOn: null };
  const proposed: string[] = [];
  const actCheck = makeActCheck({
    system,
    source: async () => source,
    loadAct,
    publish: async (event, ids) => {
      published.push(`${event.name}:${String(ids.length)}`);
    },
    proposeChange: async (document) => {
      proposed.push(document);
      return proposal;
    },
    clock,
    log: memoryLogger().log,
    notifications,
  });
  const fake = hashEmbedder(1024);
  const embedded: string[] = [];
  const embedder = makeEmbedder({
    system,
    embed: async (t) => {
      embedded.push(...t);
      return fake.embed(t);
    },
    clock,
    log: memoryLogger().log,
  });
  const daily = makeDailyCheck({
    system,
    check: actCheck,
    embedder,
    clock,
    log: memoryLogger().log,
    notifications,
  });
  return {
    clock,
    pages,
    cards,
    calls,
    published,
    notified,
    proposed,
    embedded,
    daily,
    loadAct,
    embedder,
    system,
    setProposal: (p: ChangeProposal) => (proposal = p),
    stop: () => (stop = true),
  };
}

const actId = async (pravoId: string) =>
  (await db.owner.query<{ id: string }>("select id from legal_acts where pravo_id = $1", [pravoId]))
    .rows[0]?.id ?? "";

describe("LAW-30, LAW-31: тексты", () => {
  it("HEAD: размер совпал — страницу не качаем; изменилась — новая редакция, событие act-updated, вектор только новой версии", async () => {
    const t = setup();
    await t.loadAct("H10200090");
    await t.embedder.run();
    t.embedded.length = 0;
    t.calls.text = 0;
    const same = await t.daily();
    expect(same.text["unchanged-head"]).toBe(1);
    expect(t.calls.text).toBe(0);

    t.pages["H10200090"] = page("H10200090.html").replace(
      "Основные термины и их определения",
      "Основные термины и определения",
    );
    const next = await t.daily();
    expect(next.text.updated).toBe(1);
    expect(t.published).toEqual([`legal-base.act-updated:1`]);
    expect(t.embedded).toHaveLength(1);
  });

  it("остановка загрузчика — уведомление администратору и повторяемая ошибка", async () => {
    const t = setup();
    await t.loadAct("H10200090");
    t.pages["H10200090"] += " ";
    t.stop();
    await expect(t.daily()).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(t.notified).toEqual([
      { kind: "law-update-failed", key: `loader-stopped:LOADER_BLOCKED:${t.clock.today()}` },
    ]);
  });
});

describe("LAW-34: утрата силы", () => {
  it("«Дата ограничения действия» в карточке — акт утратил силу, выходит из поиска, событие act-repealed", async () => {
    const t = setup();
    await t.loadAct("H10200090");
    t.cards["H10200090"] = card({ repealedOn: "01.06.2026" });
    const res = await t.daily();
    expect(res.repealed).toBe(1);
    const row = (
      await db.owner.query<{ status: string; repealed_on: string }>(
        "select status, to_char(repealed_on, 'YYYY-MM-DD') as repealed_on from legal_acts where pravo_id = 'H10200090'",
      )
    ).rows[0];
    expect(row).toEqual({ status: "repealed", repealed_on: "2026-06-01" });
    expect(t.published).toContain("legal-base.act-repealed:1");
    // Повторный проход: уже утратил силу — второго события нет.
    t.published.length = 0;
    await t.daily();
    expect(t.published).toEqual([]);
  });
});

describe("LAW-32: принятые, но не вступившие изменения", () => {
  const IN_TEXT = "Закон Республики Беларусь от 16 марта 2026 г. № 134-З";
  const NEW = "Закон Республики Беларусь от 5 мая 2026 г. № 150-З";

  it("изменение, которого нет в тексте, — запись «ждёт»; уже вошедшее в текст — нет; без текста изменяющего акта — уровень акта", async () => {
    const t = setup();
    await t.loadAct("H10200090");
    t.cards["H10200090"] = card({ changes: [IN_TEXT, NEW] });
    await t.daily();
    const rows = await pendingChangesOf(t.system, await actId("H10200090"));
    expect(rows.map((r) => [r.changeKey, r.articles.length, r.analyzedAt !== null])).toEqual([
      ["150-з|2026-05-05", 0, true],
    ]);
    expect(t.proposed).toEqual([]);
  });

  it("с текстом изменяющего акта модель предлагает, программа принимает только дословно найденные статьи и дату", async () => {
    const t = setup();
    await t.loadAct("H10200090");
    t.pages["H12600150"] =
      "<p>Статья 1. Внести изменения: статьи 13 и 14 изложить в новой редакции.</p><p>Настоящий Закон вступает в силу 1 июля 2026 г.</p>";
    t.cards["H10200090"] = card({ changes: [IN_TEXT, NEW] });
    t.setProposal({ articles: ["13", "14", "99"], inForceOn: "2026-07-01" });
    await t.daily();
    const rows = await pendingChangesOf(t.system, await actId("H10200090"));
    expect(rows[0]?.articles).toEqual(["13", "14"]);
    expect(rows[0]?.inForceOn).toBe("2026-07-01");
    expect(t.proposed).toHaveLength(1);
  });

  it("через 7 дней без изменений — одно уведомление администратору; когда изменение вошло в текст — запись снимается", async () => {
    const t = setup();
    await t.loadAct("H10200090");
    t.cards["H10200090"] = card({ changes: [IN_TEXT, NEW] });
    await t.daily();
    expect(t.notified).toEqual([]);
    t.clock.advance(8 * 86_400_000);
    await t.daily();
    await t.daily();
    expect(t.notified.map((n) => n.key)).toEqual([
      "change-pending:" + (await actId("H10200090")) + ":150-з|2026-05-05",
    ]);
    // Изменение вошло в текст: перечень «Изменения и дополнения» получил строку с этим актом.
    t.pages["H10200090"] = page("H10200090.html").replace(
      /(<p class="changeadd" style="">)(Закон Республики Беларусь от 16 марта 2026)/u,
      `$1${NEW} (Национальный правовой Интернет-портал)</p>\n$1$2`,
    );
    expect(t.pages["H10200090"]).toContain("№ 150-З");
    t.clock.advance(86_400_000);
    await t.daily();
    expect(await pendingChangesOf(t.system, await actId("H10200090"))).toEqual([]);
  });
});

describe("LAW-30: карточки актов вне индекса — раз в неделю", () => {
  it("карточка акта без текста читается, а через сутки — ещё нет, через неделю — снова", async () => {
    const t = setup();
    t.cards["C20200778"] = card({});
    await t.daily();
    expect(t.calls.cards.filter((id) => id === "C20200778")).toHaveLength(1);
    t.clock.advance(86_400_000);
    await t.daily();
    expect(t.calls.cards.filter((id) => id === "C20200778")).toHaveLength(1);
    t.clock.advance(7 * 86_400_000);
    await t.daily();
    expect(t.calls.cards.filter((id) => id === "C20200778")).toHaveLength(2);
  });
});
