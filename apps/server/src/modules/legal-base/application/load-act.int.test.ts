// LAW-10, LAW-20, LAW-39 на настоящем Postgres и сохранённых страницах (без сети): первая загрузка пишет снимок (gzip) и
// фрагменты, повтор той же страницы ничего не меняет, страница с иной вёрсткой или не сошедшейся канарейкой уходит в
// карантин — действующая редакция остаётся, администратор уведомлён; изменённая нормальная страница ждёт T-036.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { withChangedLayout } from "../__fixtures__/layout-changed.ts";
import { START_CATALOG } from "../domain/start-catalog.ts";
import { seedActs } from "../infrastructure/db/catalog.repo.ts";
import { ActTextNotFound, type LegalSource } from "./ports.ts";
import { makeLoadAct } from "./load-act.ts";

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
  await seedActs(createSystemDb(db.pool), START_CATALOG, "start-catalog");
});

/** Источник из словаря «ID → HTML»; нет страницы — у акта нет текста (404). */
function pages(map: Record<string, string | undefined>) {
  const source: LegalSource = {
    async fetchActText(pravoId) {
      const html = map[pravoId];
      if (html === undefined) throw new ActTextNotFound();
      return { html, fetchedAt: new Date("2026-10-30T09:00:00Z") };
    },
  };
  return source;
}

function loader(current: { source: LegalSource }) {
  const notified: { kind: string; key: string }[] = [];
  const loadAct = makeLoadAct({
    system: createSystemDb(db.pool),
    source: async () => current.source,
    clock: new FakeClock("2026-10-30T09:00:00Z"),
    log: memoryLogger().log,
    notifications: {
      notifyAdmins: async (input) => {
        notified.push({ kind: input.kind, key: input.key });
        return undefined;
      },
    },
  });
  return { loadAct, notified };
}

const act = async (pravoId: string) =>
  (
    await db.owner.query<{
      load_state: string;
      article_count: number | null;
      current_snapshot_id: string | null;
      last_problem: string | null;
      has_text: boolean;
    }>("select * from legal_acts where pravo_id = $1", [pravoId])
  ).rows[0];

const count = async (table: string) =>
  Number((await db.owner.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);

describe("LAW-10, LAW-20: первая загрузка акта", () => {
  it("Закон № 90-З: снимок в gzip, 51 статья, фрагменты и версии, акт «загружен»", async () => {
    const { loadAct } = loader({ source: pages({ H10200090: page("H10200090.html") }) });
    expect(await loadAct("H10200090")).toBe("applied");
    expect(await act("H10200090")).toMatchObject({ load_state: "loaded", article_count: 51 });
    const snap = (
      await db.owner.query<{ raw_gz: Buffer; raw_bytes: number; status: string }>(
        "select raw_gz, raw_bytes, status from legal_act_snapshots",
      )
    ).rows[0];
    expect(snap?.status).toBe("applied");
    expect(gunzipSync(snap?.raw_gz ?? Buffer.alloc(0)).toString("utf8")).toBe(
      page("H10200090.html"),
    );
    expect(snap?.raw_bytes).toBe(Buffer.byteLength(page("H10200090.html")));
    expect(await count("legal_fragments")).toBeGreaterThanOrEqual(51);
    expect(await count("legal_fragment_versions")).toBe(await count("legal_fragments"));
    const excluded = await db.owner.query<{ path_key: string }>(
      "select f.path_key from legal_fragments f join legal_fragment_versions v on v.fragment_id = f.id where v.excluded",
    );
    expect(excluded.rows).toEqual([]);
  });

  it("НК: исключённые статьи 113 и 140 хранятся со статусом «исключена»", async () => {
    const { loadAct } = loader({ source: pages({ Hk0900071: page("Hk0900071.html") }) });
    await loadAct("Hk0900071");
    const excluded = await db.owner.query<{ path_key: string }>(
      "select f.path_key from legal_fragments f join legal_fragment_versions v on v.fragment_id = f.id where v.excluded order by 1",
    );
    expect(excluded.rows.map((r) => r.path_key)).toEqual(["a113", "a140"]);
  });

  it("повторная загрузка той же страницы ничего не меняет", async () => {
    const { loadAct } = loader({ source: pages({ Hk0900071: page("Hk0900071.html") }) });
    await loadAct("Hk0900071");
    const before = [await count("legal_act_snapshots"), await count("legal_fragments")];
    expect(await loadAct("Hk0900071")).toBe("unchanged");
    expect([await count("legal_act_snapshots"), await count("legal_fragments")]).toEqual(before);
  });

  it("НК: статья 216¹ хранится с ключом 216.1 — точное обращение найдёт её по номеру", async () => {
    const { loadAct } = loader({ source: pages({ Hk0900071: page("Hk0900071.html") }) });
    await loadAct("Hk0900071");
    const rows = await db.owner.query<{ article_no: string }>(
      "select article_no from legal_fragments where path_key = 'a216.1'",
    );
    expect(rows.rows[0]?.article_no).toBe("216.1");
  });

  it("404 на странице текста — у акта только карточка, а не ошибка загрузки", async () => {
    const { loadAct } = loader({ source: pages({}) });
    expect(await loadAct("Hk0900071")).toBe("card-only");
    expect(await act("Hk0900071")).toMatchObject({ load_state: "card-only", has_text: false });
  });

  it("акт, которого нет в каталоге, не загружается", async () => {
    const { loadAct } = loader({ source: pages({}) });
    expect(await loadAct("H99999999")).toBe("unknown-act");
  });
});

describe("LAW-39: карантин и канарейки", () => {
  it("страница с иной вёрсткой уходит в карантин, действующая редакция остаётся, администратор уведомлён", async () => {
    const current = { source: pages({ H10200090: page("H10200090.html") }) };
    const { loadAct, notified } = loader(current);
    await loadAct("H10200090");
    const before = await act("H10200090");
    const fragmentsBefore = await count("legal_fragments");
    current.source = pages({ H10200090: withChangedLayout(page("H10200090.html")) });
    expect(await loadAct("H10200090")).toBe("quarantined");
    const after = await act("H10200090");
    expect(after?.load_state).toBe("quarantined");
    expect(after?.current_snapshot_id).toBe(before?.current_snapshot_id);
    expect(after?.last_problem).toContain("no-structure");
    expect(await count("legal_fragments")).toBe(fragmentsBefore);
    const current_versions = await db.owner.query(
      "select 1 from legal_fragment_versions where is_current",
    );
    expect(current_versions.rowCount).toBe(fragmentsBefore);
    expect(notified).toEqual([
      { kind: "law-layout-changed", key: expect.stringMatching(/^H10200090:[0-9a-f]{12}$/) },
    ]);
    const snapshots = await db.owner.query<{ status: string }>(
      "select status from legal_act_snapshots order by fetched_at, status",
    );
    expect(snapshots.rows.map((r) => r.status).toSorted()).toEqual(["applied", "quarantined"]);
    const log = await db.owner.query<{ event: string }>(
      "select event from legal_update_log order by at, id",
    );
    expect(log.rows.map((r) => r.event)).toEqual(["loaded", "quarantined"]);
  });

  it("первая загрузка с не той статьёй числа у канарейки (50 вместо 51) тоже в карантине, фрагментов нет", async () => {
    // Статья 48 перестала быть статьёй: у канарейки 51 статья, здесь 50.
    const without = page("H10200090.html").replace("Статья 48.", "Сорок восьмая.");
    const { loadAct, notified } = loader({ source: pages({ H10200090: without }) });
    expect(await loadAct("H10200090")).toBe("quarantined");
    expect((await act("H10200090"))?.last_problem).toContain("canary-mismatch");
    expect(await count("legal_fragments")).toBe(0);
    expect(notified).toHaveLength(1);
  });

  it("повторная доставка той же сломанной страницы не плодит снимки, а уведомление идемпотентно по ключу", async () => {
    const { loadAct, notified } = loader({
      source: pages({ H10200090: withChangedLayout(page("H10200090.html")) }),
    });
    await loadAct("H10200090");
    await loadAct("H10200090");
    expect(await count("legal_act_snapshots")).toBe(1);
    expect(new Set(notified.map((n) => n.key)).size).toBe(1);
  });

  it("изменённая страница без признаков поломки сохраняется ожидающей — редакцию применит T-036", async () => {
    const current = { source: pages({ Hk0900071: page("Hk0900071.html") }) };
    const { loadAct } = loader(current);
    await loadAct("Hk0900071");
    const changed = page("Hk0900071.html").replace(
      "в размере 216 белорусских",
      "в размере 217 белорусских",
    );
    current.source = pages({ Hk0900071: changed });
    expect(await loadAct("Hk0900071")).toBe("changed");
    const statuses = await db.owner.query<{ status: string }>(
      "select status from legal_act_snapshots",
    );
    expect(statuses.rows.map((r) => r.status).toSorted()).toEqual(["applied", "pending"]);
    expect((await act("Hk0900071"))?.load_state).toBe("loaded");
  });
});
