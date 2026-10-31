// LAW-40, LAW-16, LAW-06, LAW-17, LAW-36, ADM-10 сквозь HTTP и корень композиции (api + worker на настоящих очереди и БД, страницы
// pravo.by — из папки сохранённых, без сети, NFR-11): вкладка «Законы» — только администратору; сводка с прогрессом «N из 28»,
// контактом загрузчика и расписанием; список актов по статусам; журналы; очередь кандидатов «Добавить / Отклонить»; кнопки
// «Добавить по ссылке», «Проверить, появился ли текст», «Исключить акт», «Проверить сейчас»; настройки времени и окна; справочники.
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  registerUser,
  sessionCookie,
  STACK_PASSWORD,
  startHttpStack,
  type HttpStack,
} from "./__fixtures__/http-stack.ts";

const FIXTURES = fileURLToPath(
  new URL("../modules/legal-base/__fixtures__/pravo-by", import.meta.url),
);
const CONTACT = "operator@example.test";
const KIND = "Закон Республики Беларусь от 1 октября 2026 г. № 777-З";
const card = (title: string): string =>
  `<html><body><b>Название акта</b><div>${title}</div><b>Вид акта, орган принятия, дата и номер принятия (издания)</b><div>${KIND}</div></body></html>`;

let db: TestDb;
let stack: HttpStack;
let dir: string;
let root: string;
beforeAll(async () => {
  db = await createTestDb();
  // Сохранённые страницы плюс карточки «новых» актов, которые администратор добавит по ссылке.
  dir = await mkdtemp(join(tmpdir(), "kosht-laws-"));
  await cp(FIXTURES, dir, { recursive: true });
  await writeFile(join(dir, "card-H12600777.html"), card("О тестовых пособиях"));
  await writeFile(join(dir, "card-H12600778.html"), card("О тестовых тарифах"));
  await writeFile(join(dir, "card-D926g0999999.html"), card("О тарифах на тепловую энергию"));
  stack = await startHttpStack(db, {
    env: { LEGAL_SOURCE: "fixtures", LEGAL_FIXTURES_DIR: dir, LLM_MODELS_DOWNLOAD: "0" },
  });
  const admin = { email: "root@example.test", password: STACK_PASSWORD };
  const setup = await stack.call("local", "/identity/setup", {
    body: { ...admin, loaderContact: CONTACT },
  });
  if (setup.status !== 200) throw new Error(`первый запуск не прошёл: ${String(setup.status)}`);
  root = sessionCookie(await stack.call("local", "/identity/sign-in", { body: admin }));
  // Контакт сохраняет worker, а api видит значение не позже чем через 5 с (кэш настроек, ARCHITECTURE §9).
  await vi.waitFor(
    async () => {
      const o = await overview();
      if (o.startup.state !== "ready" || o.loaderContact !== CONTACT) {
        throw new Error("стартовый каталог ещё загружается");
      }
    },
    { timeout: 30_000, interval: 300 },
  );
});
afterAll(async () => {
  await stack.close();
  await db.drop();
  await rm(dir, { recursive: true, force: true });
});

interface Overview {
  summary: Record<string, number>;
  startup: { state: string; done: number; total: number };
  vectors: { state: string };
  schedule: {
    autoUpdate: boolean;
    checkTime: string;
    windowFrom: string;
    windowTo: string;
    lastCheck: { ok: boolean } | null;
    nextCheck: { day: string; time: string } | null;
  };
  newActsMode: string;
  loaderContact: string;
  userAgent: string;
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
const get = async <T>(path: string): Promise<T> =>
  json<T>(await stack.call("local", path, { cookie: root }));
const post = (path: string, body?: unknown) =>
  stack.call(
    "local",
    path,
    body === undefined ? { cookie: root, post: true } : { cookie: root, body },
  );
const overview = () => get<Overview>("/admin/laws");
const actRow = async (pravoId: string) =>
  (
    await db.owner.query<{ status: string; source: string; has_text: boolean; load_state: string }>(
      "select status, source, has_text, load_state from legal_acts where pravo_id = $1",
      [pravoId],
    )
  ).rows[0];

describe("LAW-40: доступ", () => {
  it("обычный пользователь и гость не открывают ни одной процедуры вкладки «Законы»", async () => {
    const user = await registerUser(stack, db, "plain@example.test");
    const calls: [string, unknown][] = [
      ["/admin/laws", undefined],
      ["/admin/laws/settings", { autoUpdate: false }],
      ["/admin/laws/acts", undefined],
      ["/admin/laws/updates", undefined],
      ["/admin/laws/fetches", undefined],
      ["/admin/laws/candidates", undefined],
      [
        "/admin/laws/candidates/decide",
        { id: "01990000-0000-7000-8000-000000000000", decision: "reject" },
      ],
      ["/admin/laws/check-now", "post"],
      ["/admin/laws/check-text", { pravoId: "C20200778" }],
      ["/admin/laws/add", { links: ["H12600777"] }],
      ["/admin/laws/exclude", { pravoId: "H10200090" }],
      ["/admin/laws/dictionary?kind=organs", undefined],
      [
        "/admin/laws/dictionary/upsert",
        { kind: "title-patterns", id: null, values: { pattern: "x" } },
      ],
      ["/admin/laws/dictionary/remove", { kind: "title-patterns", id: "x" }],
    ];
    for (const [path, body] of calls) {
      const input = body === undefined ? {} : body === "post" ? { post: true } : { body };
      const asUser = await stack.call("local", path, { cookie: user.cookie, ...input });
      const asGuest = await stack.call("local", path, input);
      expect([path, asUser.status, asGuest.status]).toEqual([path, 403, 401]);
    }
  });
});

describe("LAW-40: сводка, расписание и контакт загрузчика", () => {
  it("прогресс стартового каталога «28 из 28», сводка по актам, контакт и User-Agent, расписание по умолчанию", async () => {
    const o = await overview();
    expect(o.startup).toMatchObject({ state: "ready", done: 28, total: 28 });
    // Текст у трёх актов (есть страницы), остальные 25 — карточкой: страниц текста в папке нет.
    expect(o.summary).toMatchObject({ inIndex: 3, cardOnly: 25, repealed: 0, candidates: 0 });
    expect(o.loaderContact).toBe(CONTACT);
    expect(o.userAgent).toContain(CONTACT);
    expect(o.schedule).toMatchObject({
      autoUpdate: true,
      checkTime: "04:00",
      windowFrom: "02:00",
      windowTo: "06:00",
      lastCheck: null,
    });
    expect(o.schedule.nextCheck?.time).toBe("04:00");
    expect(o.newActsMode).toBe("auto");
  });

  it("время проверки вне ночного окна — 400 VALIDATION с названием поля, настройки не меняются", async () => {
    const response = await post("/admin/laws/settings", { checkTime: "12:00" });
    expect(response.status).toBe(400);
    expect(await json<{ data: { params: { field: string } } }>(response)).toMatchObject({
      data: { params: { field: "checkTime" } },
    });
    expect((await overview()).schedule.checkTime).toBe("04:00");
  });

  it("новое время, окно, режим новых актов, автообновление и контакт сохраняются; расписание в «Системе» показывает новый cron", async () => {
    const response = await post("/admin/laws/settings", {
      checkTime: "03:15",
      windowFrom: "01:00",
      windowTo: "05:00",
      newActsMode: "suggest",
      autoUpdate: false,
      loaderContact: "https://example.test/bot",
    });
    expect(response.status).toBe(200);
    const o = await json<Overview>(response);
    expect(o.schedule).toMatchObject({
      checkTime: "03:15",
      windowFrom: "01:00",
      windowTo: "05:00",
      autoUpdate: false,
      nextCheck: null,
    });
    expect(o).toMatchObject({ newActsMode: "suggest", loaderContact: "https://example.test/bot" });

    const system = await get<{ jobs: { schedules: { name: string; cron: string }[] } }>(
      "/admin/system",
    );
    const crons = Object.fromEntries(system.jobs.schedules.map((s) => [s.name, s.cron]));
    expect(crons["legal-base.daily-check"]).toBe("15 3 * * *");
    expect(crons["legal-base.catalog-growth"]).toBe("45 3 * * *");

    await post("/admin/laws/settings", {
      checkTime: "04:00",
      windowFrom: "02:00",
      windowTo: "06:00",
      newActsMode: "auto",
      autoUpdate: true,
      loaderContact: CONTACT,
    });
  });
});

describe("LAW-40: список актов, журналы", () => {
  it("список по статусам: «Все 28», «Актуален 3», «Только карточка 25»; фильтр и счётчики", async () => {
    const all = await get<{ total: number; counts: Record<string, number> }>("/admin/laws/acts");
    expect(all.total).toBe(28);
    expect(all.counts).toMatchObject({ all: 28, active: 3, "card-only": 25, repealed: 0 });
    const cards = await get<{ total: number; items: { status: string }[] }>(
      "/admin/laws/acts?status=card-only",
    );
    expect(cards.total).toBe(25);
    expect(new Set(cards.items.map((i) => i.status))).toEqual(new Set(["card-only"]));
  });

  it("журнал обновлений — загрузки актов с названием; журнал запросов — адрес, код ответа, размер, время", async () => {
    const updates = await get<{
      items: { event: string; pravoId: string | null; title: string | null }[];
    }>("/admin/laws/updates");
    expect(
      updates.items.find((i) => i.event === "loaded" && i.pravoId === "H10200090")?.title,
    ).toContain("потребителей");
    await db.owner.query(
      "insert into legal_fetch_log (at, url, http_status, bytes, ms, outcome) values (now(), 'https://pravo.by/document/?guid=3871&p0=H10200090', 200, 1234, 87, 'ok')",
    );
    const fetches = await get<{
      items: {
        url: string;
        httpStatus: number;
        bytes: number;
        ms: number;
        outcome: string;
        at: { time: string };
      }[];
    }>("/admin/laws/fetches");
    expect(fetches.items[0]).toMatchObject({ httpStatus: 200, bytes: 1234, ms: 87, outcome: "ok" });
    expect(fetches.items[0]?.at.time).toMatch(/^\d\d:\d\d$/u);
  });
});

describe("LAW-15, LAW-17, LAW-16: очередь кандидатов и ручное добавление", () => {
  const queue = async (pravoId: string, title: string, source = "agency") =>
    (
      await db.owner.query<{ id: string }>(
        `insert into legal_candidates (pravo_id, title, source, status, reason, has_text)
         values ($1, $2, $3, 'queued', 'manual-decision', false) returning id`,
        [pravoId, title, source],
      )
    ).rows[0]?.id ?? "";

  it("очередь показывает кандидатов с причиной; «Отклонить» убирает и больше не предлагает, повторное решение — 404", async () => {
    const id = await queue("H12600999", "Закон о чём-то");
    const list = await get<{ items: { id: string; reason: string; source: string }[] }>(
      "/admin/laws/candidates",
    );
    expect(list.items.find((c) => c.id === id)).toMatchObject({
      reason: "manual-decision",
      source: "agency",
    });
    expect((await overview()).summary.candidates).toBe(1);

    const rejected = await post("/admin/laws/candidates/decide", { id, decision: "reject" });
    expect((await json<{ items: unknown[] }>(rejected)).items).toEqual([]);
    const row = await db.owner.query<{ status: string }>(
      "select status from legal_candidates where id = $1",
      [id],
    );
    expect(row.rows[0]?.status).toBe("rejected");
    expect((await post("/admin/laws/candidates/decide", { id, decision: "reject" })).status).toBe(
      404,
    );
  });

  it("«Добавить» — акт заводится в каталог задачей worker (источник «admin», без фильтров), кандидат помечен добавленным", async () => {
    const id = await queue("H12600777", "О тестовых пособиях");
    const response = await post("/admin/laws/candidates/decide", { id, decision: "add" });
    expect(response.status).toBe(200);
    await expect
      .poll(() => actRow("H12600777"), { timeout: 20_000, interval: 200 })
      .toEqual({
        status: "active",
        source: "admin",
        has_text: false,
        load_state: "card-only",
      });
    const row = await db.owner.query<{ status: string }>(
      "select status from legal_candidates where id = $1",
      [id],
    );
    expect(row.rows[0]?.status).toBe("added");
  });

  it("«Добавить по ссылке / списком»: ссылки pravo.by и ID принимаются, местный акт тоже (LAW-06), мусор возвращается в ответе", async () => {
    const response = await post("/admin/laws/add", {
      links: [
        "https://pravo.by/document/?guid=3871&p0=H12600778",
        "D926g0999999",
        "https://example.com/?p0=H12600779",
        "не ссылка",
      ],
    });
    expect(await json<{ accepted: number; rejected: string[] }>(response)).toEqual({
      accepted: 2,
      rejected: ["https://example.com/?p0=H12600779", "не ссылка"],
    });
    await expect
      .poll(
        async () => [(await actRow("H12600778"))?.source, (await actRow("D926g0999999"))?.source],
        {
          timeout: 20_000,
          interval: 200,
        },
      )
      .toEqual(["admin", "admin"]);
    await expect
      .poll(
        async () => {
          const log = await get<{ items: { event: string; details: Record<string, number> }[] }>(
            "/admin/laws/updates",
          );
          return log.items.some((i) => i.event === "add-acts" && i.details["added"] === 2);
        },
        { timeout: 20_000, interval: 200 },
      )
      .toBe(true);
  });
});

describe("LAW-40: «Проверить, появился ли текст» и «Исключить акт»", () => {
  it("текста всё ещё нет — акт остаётся карточкой, время проверки записано; у акта с текстом проверять нечего", async () => {
    expect((await post("/admin/laws/check-text", { pravoId: "C20200778" })).status).toBe(200);
    await expect
      .poll(
        async () =>
          (
            await db.owner.query<{ t: Date | null }>(
              "select text_checked_at as t from legal_acts where pravo_id = 'C20200778'",
            )
          ).rows[0]?.t,
        { timeout: 20_000, interval: 200 },
      )
      .not.toBeNull();
    expect((await actRow("C20200778"))?.has_text).toBe(false);
    expect((await post("/admin/laws/check-text", { pravoId: "H10200090" })).status).toBe(400);
    expect((await post("/admin/laws/check-text", { pravoId: "H19999999" })).status).toBe(404);
  });

  it("текст появился — акт загружается обычным путём и становится актом с текстом", async () => {
    await cp(join(dir, "C21300569.html"), join(dir, "C21800935.html"));
    expect((await post("/admin/laws/check-text", { pravoId: "C21800935" })).status).toBe(200);
    await expect
      .poll(async () => (await actRow("C21800935"))?.load_state, { timeout: 20_000, interval: 200 })
      .toBe("loaded");
    expect((await actRow("C21800935"))?.has_text).toBe(true);
  });

  it("исключённый акт пропадает из списка администратора и из «Базы законов», записи остаются; добавление по ссылке возвращает", async () => {
    const before = await get<{ acts: { pravoId: string }[] }>("/legal-base/catalog");
    expect(before.acts.some((a) => a.pravoId === "H10200090")).toBe(true);

    expect((await post("/admin/laws/exclude", { pravoId: "H10200090" })).status).toBe(200);
    const after = await get<{ acts: { pravoId: string }[] }>("/legal-base/catalog");
    expect(after.acts.some((a) => a.pravoId === "H10200090")).toBe(false);
    const list = await get<{ items: { pravoId: string }[]; total: number }>("/admin/laws/acts");
    expect(list.items.some((a) => a.pravoId === "H10200090")).toBe(false);
    expect((await actRow("H10200090"))?.status).toBe("excluded");
    const fragments = await db.owner.query(
      "select 1 from legal_fragments f join legal_acts a on a.id = f.act_id where a.pravo_id = 'H10200090'",
    );
    expect(fragments.rowCount).toBeGreaterThan(0);
    expect((await post("/admin/laws/exclude", { pravoId: "H10200090" })).status).toBe(404);

    expect((await post("/admin/laws/add", { links: ["H10200090"] })).status).toBe(200);
    await expect
      .poll(async () => (await actRow("H10200090"))?.status, { timeout: 20_000, interval: 200 })
      .toBe("active");
  });
});

describe("LAW-40: «Проверить сейчас»", () => {
  it("задача выполняется в worker: проверка и пополнение каталога по сохранённым страницам; итог — «последняя проверка»", async () => {
    expect((await post("/admin/laws/check-now")).status).toBe(200);
    await expect
      .poll(async () => (await overview()).schedule.lastCheck, { timeout: 60_000, interval: 300 })
      .toMatchObject({ ok: true });
  });
});

describe("LAW-40: справочники — один редактор на семь видов", () => {
  it("список любого вида отдаёт поля и строки; стартовый каталог — 28 актов с группами", async () => {
    const dict = await get<{ kind: string; fields: { name: string }[]; rows: { id: string }[] }>(
      "/admin/laws/dictionary?kind=start-catalog",
    );
    expect(dict.fields.map((f) => f.name)).toEqual([
      "pravoId",
      "title",
      "label",
      "kind",
      "hasText",
      "group",
    ]);
    expect(dict.rows).toHaveLength(28);
    for (const kind of [
      "epk-topics",
      "title-patterns",
      "organs",
      "aliases",
      "colloquial",
      "agency-pages",
    ]) {
      expect(
        (await stack.call("local", `/admin/laws/dictionary?kind=${kind}`, { cookie: root })).status,
      ).toBe(200);
    }
  });

  it("добавить, изменить и удалить строку; ошибка проверки — 400 с названием поля; занятый ключ — 400", async () => {
    const added = await post("/admin/laws/dictionary/upsert", {
      kind: "title-patterns",
      id: null,
      values: { pattern: "^О премировании" },
    });
    expect((await json<{ rows: { id: string }[] }>(added)).rows.map((r) => r.id)).toContain(
      "^О премировании",
    );

    const bad = await post("/admin/laws/dictionary/upsert", {
      kind: "title-patterns",
      id: null,
      values: { pattern: "^О (премировании" },
    });
    expect(bad.status).toBe(400);
    expect(await json<{ data: { params: { field: string } } }>(bad)).toMatchObject({
      data: { params: { field: "pattern" } },
    });

    const dup = await post("/admin/laws/dictionary/upsert", {
      kind: "title-patterns",
      id: null,
      values: { pattern: "^О премировании" },
    });
    expect(dup.status).toBe(400);

    const renamed = await post("/admin/laws/dictionary/upsert", {
      kind: "title-patterns",
      id: "^О премировании",
      values: { pattern: "^О поощрении" },
    });
    expect((await json<{ rows: { id: string }[] }>(renamed)).rows.map((r) => r.id)).toContain(
      "^О поощрении",
    );
    const removed = await post("/admin/laws/dictionary/remove", {
      kind: "title-patterns",
      id: "^О поощрении",
    });
    expect((await json<{ rows: { id: string }[] }>(removed)).rows.map((r) => r.id)).not.toContain(
      "^О поощрении",
    );
    expect(
      (await post("/admin/laws/dictionary/remove", { kind: "title-patterns", id: "^О поощрении" }))
        .status,
    ).toBe(404);
  });
});
