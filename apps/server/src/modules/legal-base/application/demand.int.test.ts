// LAW-09 на Postgres и настоящих страницах: вопрос назвал акт каталога с текстом, но без индекса — задача с приоритетом
// (worker) загружает его, `api` ждёт состояние не дольше настройки; поиск помечает «акт добавлен только что»; не дождался или
// предел в сутки — карточка со ссылкой, на пределе — уведомление администратору (одно в день).
import { readFileSync } from "node:fs";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { START_CATALOG } from "../domain/start-catalog.ts";
import { seedActs, seedAliases } from "../infrastructure/db/catalog.repo.ts";
import { makeDemand } from "./demand.ts";
import { makeLoadAct } from "./load-act.ts";
import { ActTextNotFound, type LegalSource } from "./ports.ts";
import { makeLawSearch } from "./search.ts";

const page = (name: string): string =>
  readFileSync(new URL(`../__fixtures__/pravo-by/${name}`, import.meta.url), "utf8");
const S = {} as ScopedDb;

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.owner.query(
    "truncate legal_demand_loads, legal_fragment_versions, legal_fragments, legal_act_snapshots, legal_act_aliases, legal_acts cascade",
  );
  const system = createSystemDb(db.pool);
  await seedActs(system, START_CATALOG, "start-catalog");
  await seedAliases(system, START_CATALOG);
});

function setup(opts: { worker: boolean; limit?: number }) {
  const clock = new FakeClock("2026-10-30T09:00:00Z");
  const system = createSystemDb(db.pool);
  const notified: string[] = [];
  const notifications = {
    notifyAdmins: async (i: { key: string }) => {
      notified.push(i.key);
      return undefined;
    },
  } as never;
  const source: LegalSource = {
    async fetchActText(id) {
      if (id !== "Hk0900071") throw new ActTextNotFound();
      return { html: page("Hk0900071.html"), fetchedAt: clock.now() };
    },
  };
  const loadAct = makeLoadAct({
    system,
    source: async () => source,
    clock,
    log: memoryLogger().log,
    notifications,
  });
  const enqueued: string[] = [];
  const demand = makeDemand({
    system,
    // «Worker»: задачу выполняет тот, кто её принял; без worker задача остаётся ждать — api не дождётся.
    enqueue: async (_s, pravoId) => {
      enqueued.push(pravoId);
      if (opts.worker) await loadAct(pravoId);
    },
    limitPerDay: async () => opts.limit ?? 20,
    waitMs: async () => 10,
    clock,
    log: memoryLogger().log,
    notifications,
    pollMs: 1,
  });
  const search = makeLawSearch({
    system,
    demand: async (s, id) => {
      const out = await demand(s, id);
      return out === "loaded" ? "loaded" : out;
    },
    embedQuery: async () => null,
    log: memoryLogger().log,
  });
  return { demand, search, enqueued, notified, clock };
}

describe("LAW-09: догрузка по требованию", () => {
  it("«ст. 210 НК» при пустой базе: акт догружается, ответ с пометкой «добавлен только что», api сам в сеть не ходит", async () => {
    const t = setup({ worker: true });
    const out = await t.search.search("ст. 210 НК", { s: S });
    expect(out.justAdded).toBe(true);
    expect(out.fragments[0]?.pathKey).toBe("a210");
    // «НК» — два акта: Общая часть догружена первой, статья нашлась в Особенной.
    expect(t.enqueued).toContain("Hk0900071");
    // Второй вопрос — акт уже в базе: ни задачи, ни пометки.
    const again = await t.search.search("ст. 210 НК", { s: S });
    expect(again.justAdded).toBe(false);
    expect(t.enqueued).toHaveLength(2);
  });

  it("задача не успела за настройку — карточка акта со ссылкой на pravo.by вместо фрагментов", async () => {
    const t = setup({ worker: false });
    const out = await t.search.search("ст. 210 НК", { s: S });
    expect(out.fragments).toEqual([]);
    expect(out.cards.map((c) => [c.pravoId, c.hasText, c.url])).toContainEqual([
      "Hk0900071",
      true,
      "https://pravo.by/document/?guid=3871&p0=Hk0900071",
    ]);
  });

  it("предел в сутки атомарен: из шести одновременных вопросов при пределе 2 задачу ставят ровно два", async () => {
    const t = setup({ worker: false, limit: 2 });
    const ids = ["Hk0900071", "H10200090", "Hk0900071", "H10200090", "Hk0900071", "H10200090"];
    const out = await Promise.all(ids.map((id) => t.demand(S, id)));
    expect(t.enqueued).toHaveLength(2);
    expect(out.filter((o) => o === "limit")).toHaveLength(4);
  });

  it("предел в сутки: сверх него — «limit», задача не ставится, администратор уведомлён один раз за день", async () => {
    const t = setup({ worker: false, limit: 1 });
    expect(await t.demand(S, "Hk0900071")).toBe("timeout");
    expect(await t.demand(S, "H10200090")).toBe("limit");
    expect(await t.demand(S, "H10200090")).toBe("limit");
    expect(t.enqueued).toEqual(["Hk0900071"]);
    expect(t.notified).toEqual([
      `demand-limit:${t.clock.today()}`,
      `demand-limit:${t.clock.today()}`,
    ]);
    // Сутки прошли — предел снова свободен.
    t.clock.advance(25 * 3_600_000);
    expect(await t.demand(S, "H10200090")).toBe("timeout");
  });
});
