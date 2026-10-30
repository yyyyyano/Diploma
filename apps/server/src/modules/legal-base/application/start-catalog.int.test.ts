// LAW-10, LAW-36, LAW-38 на настоящем Postgres: стартовый каталог заводится сразу (карточки — «загружены»), загрузка идёт
// актами и продолжается с места остановки; ошибка акта и остановка загрузчика — повторяемая ошибка задачи; прогресс
// «Загружено N из 28» и причина остановки видны экрану первого запуска.
import { readFileSync } from "node:fs";
import { LocalDate } from "@kosht/kernel";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { Settings } from "../../../platform/settings/settings.ts";
import { makeLoaderStore } from "../infrastructure/db/loader.repo.ts";
import { LEGAL_AUTOLOAD, LOADER_CONTACT } from "../settings.ts";
import { makeLoadAct } from "./load-act.ts";
import { ActTextNotFound, LoaderStopped, SourceUnavailable, type LegalSource } from "./ports.ts";
import { makeStartCatalog } from "./start-catalog.ts";

const page = (name: string): string =>
  readFileSync(new URL(`../__fixtures__/pravo-by/${name}`, import.meta.url), "utf8");

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.owner.query(
    "truncate legal_update_log, legal_fragment_versions, legal_fragments, legal_act_snapshots, legal_acts cascade",
  );
  await db.owner.query("update legal_loader_state set stopped_on = null, stop_reason = null");
});

type Reply = string | { readonly fail: "unavailable" | "stopped" } | undefined;

function setup(opts: { reply: (pravoId: string) => Reply; contact?: string; autoload?: boolean }) {
  const clock = new FakeClock("2026-10-30T09:00:00Z");
  const system = createSystemDb(db.pool);
  const notified: { kind: string; key: string; params?: unknown }[] = [];
  const source: LegalSource = {
    async fetchActText(pravoId) {
      const reply = opts.reply(pravoId);
      if (typeof reply === "object") {
        if (reply.fail === "unavailable") throw new SourceUnavailable();
        throw new LoaderStopped("LOADER_BLOCKED");
      }
      if (reply === undefined) throw new ActTextNotFound();
      return { html: reply, fetchedAt: clock.now() };
    },
  };
  const settings = {
    get: async (def: { key: string }) => {
      if (def.key === LOADER_CONTACT.key) return opts.contact ?? "operator@example.test";
      if (def.key === LEGAL_AUTOLOAD.key) return opts.autoload ?? true;
      throw new Error(def.key);
    },
  } as unknown as Pick<Settings, "get">;
  const notifications = {
    notifyAdmins: async (input: { kind: string; key: string; params?: unknown }) => {
      notified.push(input);
      return undefined;
    },
  };
  const loadAct = makeLoadAct({
    system,
    source: async () => source,
    clock,
    log: memoryLogger().log,
    notifications: notifications as never,
  });
  const catalog = makeStartCatalog({
    system,
    loadAct,
    settings,
    clock,
    log: memoryLogger().log,
    notifications: notifications as never,
    loader: makeLoaderStore(system),
  });
  const ctx = { signal: new AbortController().signal, progress: async () => {} };
  return { catalog, notified, ctx, clock, system };
}

const good = (id: string): Reply =>
  ({
    H10200090: page("H10200090.html"),
    Hk0900071: page("Hk0900071.html"),
    C21300569: page("C21300569.html"),
  })[id as "H10200090"];

describe("LAW-10: стартовый каталог", () => {
  it("до первого запуска — «ждём», после заведения — «5 из 28»: пять карточек загружены сразу", async () => {
    const t = setup({ reply: good });
    expect(await t.catalog.progress()).toMatchObject({ state: "waiting", total: 0 });
    await t.catalog.seed();
    expect(await t.catalog.progress()).toEqual({
      state: "loading",
      done: 5,
      total: 28,
      problems: 0,
      stopReason: null,
    });
  });

  it("загрузка доходит до «28 из 28»: три страницы есть, у остальных текста нет — только карточка", async () => {
    const t = setup({ reply: good });
    await t.catalog.run(t.ctx);
    expect(await t.catalog.progress()).toMatchObject({ state: "ready", done: 28, total: 28 });
    const states = await db.owner.query<{ load_state: string; n: string }>(
      "select load_state, count(*) as n from legal_acts group by load_state",
    );
    expect(Object.fromEntries(states.rows.map((r) => [r.load_state, Number(r.n)]))).toEqual({
      loaded: 3,
      "card-only": 25,
    });
  });

  it("повторный запуск задачи продолжает с места остановки и не загружает готовое второй раз", async () => {
    const asked: string[] = [];
    const t = setup({
      reply: (id) => {
        asked.push(id);
        return id === "Hk0900071" ? { fail: "unavailable" } : good(id);
      },
    });
    await expect(t.catalog.run(t.ctx)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await t.catalog.progress()).toMatchObject({ state: "loading", problems: 1 });
    asked.length = 0;
    const second = setup({ reply: (id) => (asked.push(id), good(id)) });
    await second.catalog.run(second.ctx);
    // Спрашивались только акт с ошибкой и ещё не пробованные; загруженный Закон № 90-З — нет.
    expect(asked).not.toContain("H10200090");
    expect(asked).toContain("Hk0900071");
    expect(await second.catalog.progress()).toMatchObject({ state: "ready", done: 28 });
  });
});

describe("LAW-36, LAW-38: остановка загрузчика", () => {
  it("пустой контакт — «остановлен: контакт не задан», пока акты не загружены", async () => {
    const t = setup({ reply: good, contact: " " });
    await t.catalog.seed();
    expect(await t.catalog.progress()).toMatchObject({
      state: "stopped",
      stopReason: "LOADER_CONTACT_EMPTY",
    });
  });

  it("403/429 останавливают цикл: администратору — уведомление, задача — повторяемая ошибка, акт не помечается ошибкой", async () => {
    const t = setup({ reply: () => ({ fail: "stopped" }) });
    await expect(t.catalog.run(t.ctx)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(t.notified).toEqual([
      {
        kind: "law-update-failed",
        key: `loader-stopped:LOADER_BLOCKED:${t.clock.today()}`,
        params: { reason: "LOADER_BLOCKED" },
      },
    ]);
    const failed = await db.owner.query("select 1 from legal_acts where load_state = 'failed'");
    expect(failed.rowCount).toBe(0);
  });

  it("остановка, записанная загрузчиком в БД, видна в прогрессе до следующих суток", async () => {
    const t = setup({ reply: good });
    await t.catalog.seed();
    await makeLoaderStore(t.system).stop(
      LocalDate.parse(t.clock.today()),
      "LOADER_TOO_MANY_ERRORS",
    );
    expect(await t.catalog.progress()).toMatchObject({
      state: "stopped",
      stopReason: "LOADER_TOO_MANY_ERRORS",
    });
    t.clock.advance(24 * 3_600_000);
    expect((await t.catalog.progress()).state).toBe("loading");
  });
});

describe("настройка legal-base.autoload", () => {
  it("выключена — прогресс «выключено», без каталога и запросов", async () => {
    const t = setup({ reply: good, autoload: false });
    expect(await t.catalog.progress()).toMatchObject({ state: "off", total: 0 });
  });
});
