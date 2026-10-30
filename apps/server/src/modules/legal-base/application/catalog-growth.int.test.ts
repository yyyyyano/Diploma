// LAW-11…17 на Postgres: граф ссылок, «Новые поступления» (настоящая страница за 29.10.2026), фильтры без модели, тема по
// рубрикам ЕПК, модель только для спорных, маршруты, очередь кандидатов, журнал спроса, ведомственные страницы.
// Сети нет: источник — стаб над сохранёнными страницами; модель — стаб на границе (`classify`); кассеты — T-055.
import { readFileSync } from "node:fs";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { SettingDef } from "../../../platform/settings/settings.ts";
import type { Topic } from "../domain/topics.ts";
import { START_CATALOG } from "../domain/start-catalog.ts";
import { seedActs } from "../infrastructure/db/catalog.repo.ts";
import { decideCandidate } from "../infrastructure/db/growth.repo.ts";
import { makeCatalogGrowth } from "./catalog-growth.ts";
import { makeLoadAct } from "./load-act.ts";
import {
  ActTextNotFound,
  LoaderStopped,
  type DiscoverySource,
  type LegalSource,
  type RegistrySource,
} from "./ports.ts";
import { AGENCY_PAGES, NEW_ACTS_MODE, TEXT_CHECK_WEEKS } from "../settings.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../__fixtures__/pravo-by/${name}`, import.meta.url), "utf8");

/** Страница «Новые поступления» в вёрстке реестра: dl → dt (номер, дата) и dd → p → a (название) + строка вида акта. */
function arrivals(entries: { id: string; title: string; kind: string; no: string }[]): string {
  const items = entries
    .map(
      (e) =>
        `<dl><dt>${e.no}<br/>(29.10.2026)</dt><dd><p><a href="/document/?guid=3961&amp;p0=${e.id}">${e.title}</a><br/>${e.kind}</p></dd></dl>`,
    )
    .join("\n");
  return `<html><body><p class="section-counter">Количество зарегистрированных правовых актов: ${entries.length}</p>${items}</body></html>`;
}

const card = (title: string, kind: string, repealedOn?: string): string =>
  `<html><body><b>Название акта</b><div>${title}</div><b>Вид акта, орган принятия, дата и номер принятия (издания)</b><div>${kind}</div>${
    repealedOn === undefined ? "" : `<b>Дата ограничения действия</b><div>${repealedOn}</div>`
  }</body></html>`;

const rubrics = (...codes: string[]): string =>
  `<html><body><ul>${codes.map((c) => `<li>${c} Рубрика</li>`).join("")}</ul></body></html>`;

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.owner.query(
    "truncate legal_candidates, legal_demand_log, legal_growth_marks, legal_pending_changes, legal_fragment_embeddings, legal_update_log, legal_fragment_versions, legal_fragments, legal_act_snapshots, legal_acts cascade",
  );
  await seedActs(createSystemDb(db.pool), START_CATALOG, "start-catalog");
});

interface Setup {
  arrivalsHtml?: (day: string) => string;
  cards?: Record<string, string>;
  withText?: string[];
  rubricPages?: Record<string, string>;
  texts?: Record<string, string>;
  overrides?: Record<string, unknown>;
  topics?: Record<string, Topic | null>;
  loaderStopped?: boolean;
  /** Облачная цепочка недоступна: модель бросает ошибку. */
  modelDown?: boolean;
  agencyPages?: Record<string, string>;
}

function setup(opts: Setup = {}) {
  const clock = new FakeClock("2026-10-30T02:00:00Z");
  const system = createSystemDb(db.pool);
  const log = memoryLogger();
  const calls = {
    arrivals: [] as string[],
    cards: [] as string[],
    heads: [] as string[],
    classified: [] as string[],
    loaded: [] as string[],
    checkedCards: [] as string[],
    checkedTexts: [] as string[],
    agency: [] as string[],
    embedded: 0,
  };
  const notified: { kind: string; key: string; params?: unknown }[] = [];
  const source: LegalSource & RegistrySource & DiscoverySource = {
    async fetchArrivals(day) {
      calls.arrivals.push(day);
      if (opts.loaderStopped === true) throw new LoaderStopped("LOADER_BLOCKED");
      return {
        html: opts.arrivalsHtml?.(day) ?? fixture("novye-postupleniya.html"),
        fetchedAt: clock.now(),
      };
    },
    async fetchActCard(id) {
      calls.cards.push(id);
      const html = opts.cards?.[id];
      if (html === undefined) throw new ActTextNotFound();
      return { html, fetchedAt: clock.now() };
    },
    async headActText(id) {
      calls.heads.push(id);
      if (!(opts.withText ?? []).includes(id)) throw new ActTextNotFound();
      return { contentLength: 1 };
    },
    async fetchActText(id) {
      const html = opts.texts?.[id];
      if (html === undefined) throw new ActTextNotFound();
      return { html, fetchedAt: clock.now() };
    },
    async fetchActRubrics(id) {
      const html = opts.rubricPages?.[id];
      return html === undefined ? null : { html, fetchedAt: clock.now() };
    },
  };
  const settings = {
    get: async <T>(def: SettingDef<T>): Promise<T> =>
      (opts.overrides?.[def.key] as T | undefined) ?? def.default,
  };
  const plainLoad = makeLoadAct({
    system,
    source: async () => source,
    clock,
    log: log.log,
    notifications: { notifyAdmins: async () => undefined } as never,
  });
  const growth = makeCatalogGrowth({
    system,
    source: async () => source,
    agencies: {
      fetchAgencyPage: async (url) => {
        calls.agency.push(url);
        return { html: opts.agencyPages?.[url] ?? "", fetchedAt: clock.now() };
      },
    },
    loadAct: async (pravoId) => {
      calls.loaded.push(pravoId);
      return plainLoad(pravoId);
    },
    actCheck: {
      checkCard: async (act) => {
        calls.checkedCards.push(act.pravoId);
        return "ok";
      },
      checkText: async (act) => {
        calls.checkedTexts.push(act.pravoId);
        return "unchanged-head";
      },
    },
    classify: async (title) => {
      calls.classified.push(title);
      if (opts.modelDown === true) throw new Error("провайдер недоступен");
      return opts.topics?.[title] ?? null;
    },
    embedder: {
      run: async () => {
        calls.embedded += 1;
        return { state: "idle", total: 0, embedded: 0, model: null };
      },
    },
    settings,
    clock,
    log: log.log,
    notifications: {
      notifyAdmins: async (i: { kind: string; key: string; params?: unknown }) => {
        notified.push(i);
        return undefined;
      },
    } as never,
  });
  return { clock, system, growth, calls, notified, plainLoad };
}

const rows = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.owner.query<T>(sql, params)).rows;
const candidate = async (pravoId: string) =>
  (
    await rows<{ status: string; reason: string | null; topic: string | null }>(
      "select status, reason, topic from legal_candidates where pravo_id = $1",
      [pravoId],
    )
  )[0];
const drops = async () =>
  rows<{ details: { pravoId: string; reason: string } }>(
    "select details from legal_update_log where event = 'candidate-dropped'",
  );

describe("LAW-12, LAW-13: новые поступления и фильтры без модели (настоящая страница 29.10.2026)", () => {
  const TOPICS: Record<string, Topic | null> = {
    "О торговле маркированными ювелирными изделиями": "consumer",
    "О Министерстве антимонопольного регулирования и торговли Республики Беларусь": null,
    "О вопросах обеспечения безопасности генно-инженерной деятельности": null,
  };

  it("кадровый акт и местные акты отсекаются без модели, причина в журнале; изменяющие — событие, а не запись каталога", async () => {
    const t = setup({ topics: TOPICS });
    expect(await t.growth.discoverArrivals()).toBe(34);
    await t.growth.evaluate();

    expect(await candidate("C22600550")).toMatchObject({
      status: "dropped",
      reason: "title-pattern",
    });
    expect(await candidate("D926g0148285")).toMatchObject({ status: "dropped", reason: "local" });
    const reasons = (await drops()).filter((r) => r.details.pravoId === "C22600550");
    expect(reasons.map((r) => r.details.reason)).toEqual(["title-pattern"]);
    // «Об изменении Указа …», «Об изменении постановлений Совета Министров …», «О признании утратившими силу …»:
    for (const id of ["P32600392", "C22600551", "W22645393", "T22606402p"]) {
      expect(await candidate(id)).toMatchObject({ status: "event", reason: "amending" });
    }
    const amendingInCatalog = await rows("select 1 from legal_acts where pravo_id = 'P32600392'");
    expect(amendingInCatalog).toHaveLength(0);
  });

  it("модель зовётся только для спорных: три акта без органа, рубрики и слов темы в заголовке", async () => {
    const t = setup({ topics: TOPICS });
    await t.growth.discoverArrivals();
    await t.growth.evaluate();
    expect(t.calls.classified.toSorted()).toEqual(Object.keys(TOPICS).toSorted());
    // Ответ модели «не про деньги» — отсев с причиной; тема — карточка нового акта без текста (LAW-17, «новые поступления»).
    expect(await candidate("W22645392")).toMatchObject({
      status: "dropped",
      reason: "model-irrelevant",
    });
    expect(await candidate("P32600393")).toMatchObject({ status: "added", reason: "card" });
    const act = await rows<{
      source: string;
      has_text: boolean;
      topic: string;
      topic_source: string;
      load_state: string;
    }>(
      "select source, has_text, topic, topic_source, load_state from legal_acts where pravo_id = 'P32600393'",
    );
    expect(act[0]).toMatchObject({
      source: "new-arrivals",
      has_text: false,
      topic: "consumer",
      topic_source: "model",
      load_state: "card-only",
    });
  });

  it("добавленный акт — уведомление администратору «добавлены новые акты» одним сообщением за день", async () => {
    const t = setup({ topics: TOPICS });
    await t.growth.discoverArrivals();
    await t.growth.evaluate();
    expect(t.notified.filter((n) => n.kind === "law-new-acts")).toEqual([
      { kind: "law-new-acts", key: "new-acts:2026-10-30", params: { count: 1 } },
    ]);
  });

  it("«только предлагать» превращает автодобавление новых поступлений в очередь администратора", async () => {
    const t = setup({ topics: TOPICS, overrides: { [NEW_ACTS_MODE.key]: "suggest" } });
    await t.growth.discoverArrivals();
    await t.growth.evaluate();
    expect(await candidate("P32600393")).toMatchObject({
      status: "queued",
      reason: "suggest-only",
      topic: "consumer",
    });
    expect(await rows("select 1 from legal_acts where pravo_id = 'P32600393'")).toHaveLength(0);
  });

  it("бюджет проверок с запросами ограничен: остальные ждут следующей ночи, отсев без сети — не тратит бюджет", async () => {
    const t = setup({ topics: TOPICS, overrides: { "legal-base.growth-batch": 1 } });
    await t.growth.discoverArrivals();
    await t.growth.evaluate();
    const waiting = await rows("select 1 from legal_candidates where status = 'found'");
    expect(waiting.length).toBeGreaterThan(0);
    expect(await candidate("D926g0148285")).toMatchObject({ status: "dropped" });
  });
});

describe("LAW-12: пропущенные дни", () => {
  it("после пяти выключенных дней читаются все пропущенные дни по вчерашний", async () => {
    const t = setup();
    await db.owner.query(
      "insert into legal_growth_marks (key, day) values ('arrivals-day', '2026-10-25')",
    );
    await t.growth.discoverArrivals();
    expect(t.calls.arrivals).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]);
  });

  it("глубже 30 дней назад не читаем", async () => {
    const t = setup();
    await db.owner.query(
      "insert into legal_growth_marks (key, day) values ('arrivals-day', '2026-06-01')",
    );
    await t.growth.discoverArrivals();
    expect(t.calls.arrivals[0]).toBe("2026-09-30");
    expect(t.calls.arrivals).toHaveLength(30);
  });

  it("первый проход читает только вчерашний день", async () => {
    const t = setup();
    await t.growth.discoverArrivals();
    expect(t.calls.arrivals).toEqual(["2026-10-29"]);
  });

  it("страница иной вёрстки: число актов не сошлось — день не засчитан, администратору уведомление", async () => {
    const t = setup({ arrivalsHtml: () => "<html><body><p>Технические работы</p></body></html>" });
    expect(await t.growth.discoverArrivals()).toBe(0);
    expect(await rows("select 1 from legal_growth_marks where key = 'arrivals-day'")).toHaveLength(
      0,
    );
    expect(t.notified).toEqual([
      {
        kind: "law-layout-changed",
        key: "arrivals:2026-10-29",
        params: { pravoId: "novye-postupleniya" },
      },
    ]);
  });
});

describe("LAW-12: изменяющий акт — событие внеплановой проверки", () => {
  const amending = (title: string) =>
    arrivals([
      {
        id: "C22600551",
        title,
        kind: "Постановление Совета Министров Республики Беларусь от 29 октября 2026 г. № 551",
        no: "6-2/56393",
      },
    ]);

  it("заголовок называет изменяемые постановления — загруженный из них проверяется внепланово (карточка и текст)", async () => {
    const t = setup({
      arrivalsHtml: () =>
        amending(
          "Об изменении постановлений Совета Министров Республики Беларусь от 28 июня 2013 г. № 569 и от 28 июня 2023 г. № 416",
        ),
    });
    await db.owner.query(
      "update legal_acts set load_state = 'loaded' where pravo_id = 'C21300569'",
    );
    await t.growth.discoverArrivals();
    await t.growth.evaluate();
    expect(t.calls.checkedCards).toEqual(["C21300569"]);
    expect(t.calls.checkedTexts).toEqual(["C21300569"]);
    expect(await candidate("C22600551")).toMatchObject({ status: "event" });
  });

  it("заголовок без реквизитов: изменяемые акты берутся из текста изменяющего акта", async () => {
    const t = setup({
      arrivalsHtml: () =>
        amending("Об изменении постановлений Совета Министров Республики Беларусь"),
      texts: {
        C22600551: `<html><body><p class="article">Внести в постановление Совета Министров Республики Беларусь от 28 июня 2013 г. № 569 изменения.</p></body></html>`,
      },
    });
    await db.owner.query(
      "update legal_acts set load_state = 'loaded' where pravo_id = 'C21300569'",
    );
    await t.growth.discoverArrivals();
    await t.growth.evaluate();
    expect(t.calls.checkedCards).toEqual(["C21300569"]);
  });
});

describe("LAW-11, LAW-13, LAW-14, LAW-17: граф ссылок", () => {
  it("ссылки из текста загруженного акта — кандидаты на один шаг, акты каталога не повторяются, повторный разбор ничего не даёт", async () => {
    const t = setup({ texts: { C21300569: fixture("C21300569.html") } });
    await t.plainLoad("C21300569");
    const found = await t.growth.discoverLinks();
    expect(found).toBeGreaterThan(0);
    expect(await candidate("C20600522")).toMatchObject({ status: "found" });
    // Закон о государственных пособиях уже в стартовом каталоге — кандидатом не становится.
    expect(await candidate("H11200007")).toBeUndefined();
    expect(await t.growth.discoverLinks()).toBe(0);
  });

  it("с текстом и рубрикой ЕПК → индекс автоматически; тема из ЕПК записана; текст загружается в тот же проход", async () => {
    const t = setup({
      cards: {
        C20600522: card(
          "О порядке налогообложения",
          "Постановление Совета Министров Республики Беларусь от 1 июня 2006 г. № 522",
        ),
      },
      withText: ["C20600522"],
      rubricPages: { C20600522: rubrics("03.02.01") },
    });
    await db.owner.query(
      "insert into legal_candidates (pravo_id, source) values ('C20600522', 'link-graph')",
    );
    await t.growth.evaluate();
    expect(await candidate("C20600522")).toMatchObject({
      status: "added",
      reason: "index",
      topic: "taxes",
    });
    expect(t.calls.loaded).toEqual(["C20600522"]);
    expect(t.calls.classified).toEqual([]);
  });

  it("настоящая страница рубрик (90-З, рубрика в комментарии) определяет тему: 04.01.14 → потребители", async () => {
    const t = setup({
      cards: {
        P30600075: card(
          "О защите прав",
          "Указ Президента Республики Беларусь от 1 февраля 2006 г. № 75",
        ),
      },
      withText: ["P30600075"],
      rubricPages: { P30600075: fixture("rubrics-H10200090.html") },
    });
    await db.owner.query(
      "insert into legal_candidates (pravo_id, source) values ('P30600075', 'link-graph')",
    );
    await t.growth.evaluate();
    expect(await candidate("P30600075")).toMatchObject({
      status: "added",
      reason: "index",
      topic: "consumer",
    });
  });

  it("с текстом, но рубрики нет — очередь «предложенные», а не индекс; подсказка темы — по заголовку", async () => {
    const t = setup({
      cards: {
        P30600075: card(
          "О мерах по налогам",
          "Указ Президента Республики Беларусь от 1 февраля 2006 г. № 75",
        ),
      },
      withText: ["P30600075"],
    });
    await db.owner.query(
      "insert into legal_candidates (pravo_id, source) values ('P30600075', 'link-graph')",
    );
    await t.growth.evaluate();
    expect(await candidate("P30600075")).toMatchObject({
      status: "queued",
      reason: "no-topic",
      topic: "taxes",
    });
    expect(t.calls.loaded).toEqual([]);
  });

  it("без текста: тема по органу — карточка; нет ни органа, ни слов темы — зовётся модель, «не про деньги» — отсев", async () => {
    const t = setup({
      cards: {
        P30600075: card(
          "О мерах государственной поддержки",
          "Указ Президента Республики Беларусь от 1 февраля 2006 г. № 75",
        ),
        C20900182: card(
          "О платных услугах",
          "Постановление Министерства здравоохранения Республики Беларусь от 10 февраля 2009 г. № 18",
        ),
      },
    });
    await db.owner.query(
      "insert into legal_candidates (pravo_id, source) values ('P30600075','link-graph'), ('C20900182','link-graph')",
    );
    await t.growth.evaluate();
    expect(await candidate("P30600075")).toMatchObject({
      status: "dropped",
      reason: "model-irrelevant",
    });
    expect(await candidate("C20900182")).toMatchObject({ status: "added", reason: "card" });
    expect(t.calls.classified).toEqual(["О мерах государственной поддержки"]);
  });

  it("модель недоступна: акт без текста и без темы из графа ссылок отсекается с причиной, акт с текстом идёт в очередь", async () => {
    const t = setup({
      modelDown: true,
      cards: {
        P30600075: card(
          "О мерах государственной поддержки",
          "Указ Президента Республики Беларусь от 1 февраля 2006 г. № 75",
        ),
        P30600076: card(
          "О мерах по иным вопросам",
          "Указ Президента Республики Беларусь от 1 февраля 2006 г. № 76",
        ),
      },
      withText: ["P30600076"],
    });
    await db.owner.query(
      "insert into legal_candidates (pravo_id, source) values ('P30600075','link-graph'), ('P30600076','link-graph')",
    );
    await t.growth.evaluate();
    expect(await candidate("P30600075")).toMatchObject({ status: "dropped", reason: "no-topic" });
    expect(await candidate("P30600076")).toMatchObject({ status: "queued", reason: "no-topic" });
  });

  it("утративший силу по карточке отсекается до запроса текста", async () => {
    const t = setup({
      cards: {
        P30600075: card("О налогах", "Указ Президента от 1 февраля 2006 г. № 75", "01.01.2020"),
      },
      withText: ["P30600075"],
    });
    await db.owner.query(
      "insert into legal_candidates (pravo_id, source) values ('P30600075','link-graph')",
    );
    await t.growth.evaluate();
    expect(await candidate("P30600075")).toMatchObject({ status: "dropped", reason: "repealed" });
    expect(t.calls.heads).toEqual([]);
  });

  it("карточки нет на pravo.by — отсев «card-not-found», а не ошибка прохода", async () => {
    const t = setup();
    await db.owner.query(
      "insert into legal_candidates (pravo_id, source) values ('HK0600134','link-graph')",
    );
    await t.growth.evaluate();
    expect(await candidate("HK0600134")).toMatchObject({
      status: "dropped",
      reason: "card-not-found",
    });
  });

  it("отклонённый администратором кандидат повторно не предлагается", async () => {
    const t = setup({ texts: { C21300569: fixture("C21300569.html") } });
    await t.plainLoad("C21300569");
    await t.growth.discoverLinks();
    const id =
      (
        await rows<{ id: string }>("select id from legal_candidates where pravo_id = 'C20600522'")
      )[0]?.id ?? "";
    await decideCandidate(t.system, id, { status: "rejected" }, t.clock.now());
    await db.owner.query("update legal_acts set links_scanned_snapshot_id = null");
    await t.growth.discoverLinks();
    expect(await candidate("C20600522")).toMatchObject({ status: "rejected" });
  });
});

describe("LAW-15: ведомственные страницы и журнал спроса", () => {
  const PAGE = "https://www.nalog.gov.by/ru/zakon/";
  const links = `<a href="https://pravo.by/document/?guid=3871&p0=P31700240">Указ</a><a href="https://etalonline.by/x">нет</a>`;

  it("раз в месяц ссылки на pravo.by со страницы ведомства — в очередь администратора, текст с сайта не берётся", async () => {
    const t = setup({
      overrides: { [AGENCY_PAGES.key]: [PAGE] },
      agencyPages: { [PAGE]: links },
      cards: {
        P31700240: card(
          "О налоговых льготах",
          "Указ Президента Республики Беларусь от 4 июля 2017 г. № 240",
        ),
      },
      withText: ["P31700240"],
    });
    expect(await t.growth.discoverAgencies()).toBe(1);
    await t.growth.evaluate();
    expect(await candidate("P31700240")).toMatchObject({
      status: "queued",
      reason: "manual-decision",
    });
    // Повторно — только через месяц.
    expect(await t.growth.discoverAgencies()).toBe(0);
    expect(t.calls.agency).toEqual([PAGE]);
    t.clock.advance(31 * 86_400_000);
    await t.growth.discoverAgencies();
    expect(t.calls.agency).toEqual([PAGE, PAGE]);
  });

  it("список страниц пуст по умолчанию: ничего не запрашивается", async () => {
    const t = setup();
    expect(await t.growth.discoverAgencies()).toBe(0);
    expect(t.calls.agency).toEqual([]);
  });

  it("recordDemand пишет тему и акты без текста вопроса; в таблице нет колонки для текста", async () => {
    const t = setup();
    await t.growth.recordDemand({ topic: "taxes", actIds: ["Hk0900071", "Hk0900071"] });
    expect(await rows("select topic, pravo_ids from legal_demand_log")).toEqual([
      { topic: "taxes", pravo_ids: ["Hk0900071"] },
    ]);
    const columns = await rows<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'legal_demand_log' order by column_name",
    );
    expect(columns.map((c) => c.column_name)).toEqual(["at", "id", "pravo_ids", "topic"]);
  });

  it.each([
    [{ topic: "как мне вернуть деньги за телефон", actIds: [] }],
    [{ topic: "taxes", actIds: ["../etc"] }],
    [
      {
        topic: "taxes",
        actIds: Array.from({ length: 21 }, (_, i) => `H1260${String(i).padStart(4, "0")}`),
      },
    ],
  ])("recordDemand отвергает не тему из десяти и не ID акта: %j", async (input) => {
    await expect(setup().growth.recordDemand(input)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("недельная сводка: акты каталога без индекса — в очередь; в индексе — не предлагаются; раз в неделю", async () => {
    const t = setup();
    await t.growth.recordDemand({ topic: "benefits", actIds: ["C20200778", "H10800369"] });
    await db.owner.query(
      "update legal_acts set load_state = 'loaded' where pravo_id = 'H10800369'",
    );
    await t.growth.summarizeDemand();
    expect(await candidate("C20200778")).toMatchObject({
      status: "queued",
      reason: "manual-decision",
    });
    expect(await candidate("H10800369")).toBeUndefined();
    const summary = await rows<{ details: Record<string, number> }>(
      "select details from legal_update_log where event = 'demand-summary'",
    );
    expect(summary[0]?.details).toEqual({ questions: 1, topics: 1, queued: 1 });
    await t.growth.summarizeDemand();
    expect(
      await rows("select 1 from legal_update_log where event = 'demand-summary'"),
    ).toHaveLength(1);
  });
});

describe("LAW-13 п. 4: у нового акта без текста текст проверяется раз в неделю 8 недель", () => {
  async function newArrivalCard(t: ReturnType<typeof setup>, ageDays: number) {
    await t.growth.discoverArrivals();
    await db.owner.query(
      "insert into legal_acts (pravo_id, title, kind, has_text, source, load_state, created_at) values ('P32600393', 'Указ', 'decree', false, 'new-arrivals', 'card-only', $1)",
      [new Date(t.clock.now().getTime() - ageDays * 86_400_000)],
    );
  }

  it("текст появился и рубрика ЕПК определяет тему — акт загружается в индекс", async () => {
    const t = setup({
      withText: ["P32600393"],
      rubricPages: { P32600393: rubrics("04.01.14") },
      texts: { P32600393: fixture("C21300569.html") },
    });
    await newArrivalCard(t, 8);
    expect(await t.growth.recheckText()).toBe(1);
    const act = await rows<{ has_text: boolean; topic: string; load_state: string }>(
      "select has_text, topic, load_state from legal_acts where pravo_id = 'P32600393'",
    );
    expect(act[0]).toMatchObject({ has_text: true, topic: "consumer", load_state: "loaded" });
    expect(t.calls.loaded).toEqual(["P32600393"]);
  });

  it("текста всё ещё нет — отметка проверки; раньше чем через неделю повторно не проверяется", async () => {
    const t = setup();
    await newArrivalCard(t, 8);
    await t.growth.recheckText();
    expect(t.calls.heads).toEqual(["P32600393"]);
    await t.growth.recheckText();
    expect(t.calls.heads).toEqual(["P32600393"]);
  });

  it("через 8 недель проверка прекращается", async () => {
    const t = setup({ withText: ["P32600393"] });
    await newArrivalCard(t, 57);
    expect(await t.growth.recheckText()).toBe(0);
    expect(t.calls.heads).toEqual([]);
  });

  it("текст есть, а тема не определена — акт не индексируется сам: в очередь администратора", async () => {
    const t = setup({ withText: ["P32600393"] });
    await newArrivalCard(t, 8);
    await db.owner.query(
      "insert into legal_candidates (pravo_id, source, status) values ('P32600393', 'new-arrivals', 'added') on conflict do nothing",
    );
    await t.growth.recheckText();
    expect(await candidate("P32600393")).toMatchObject({
      status: "queued",
      reason: "text-appeared",
    });
    expect(t.calls.loaded).toEqual([]);
  });
});

describe("LAW-35, LAW-38: остановка загрузчика", () => {
  it("403/429 при чтении новых поступлений — уведомление администратору, повторяемая ошибка, день не засчитан", async () => {
    const t = setup({ loaderStopped: true });
    await expect(t.growth.run()).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(t.notified).toEqual([
      {
        kind: "law-update-failed",
        key: "loader-stopped:LOADER_BLOCKED:2026-10-30",
        params: { reason: "LOADER_BLOCKED" },
      },
    ]);
    expect(await rows("select 1 from legal_growth_marks where key = 'arrivals-day'")).toHaveLength(
      0,
    );
  });

  it("целый проход: находки, отсев, очередь, векторы новых актов — и повтор в тот же день ничего не дублирует", async () => {
    const t = setup({
      topics: { "О торговле маркированными ювелирными изделиями": "consumer" },
      overrides: { [TEXT_CHECK_WEEKS.key]: 8 },
    });
    await t.growth.run();
    expect(t.calls.embedded).toBe(1);
    const before = await rows("select 1 from legal_candidates");
    await t.growth.run();
    expect(await rows("select 1 from legal_candidates")).toHaveLength(before.length);
  });
});
