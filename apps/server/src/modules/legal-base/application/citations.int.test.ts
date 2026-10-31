// LEGAL-03, LEGAL-05, LEGAL-08, CHAT-10 на настоящем Postgres и настоящих страницах: версия фрагмента по id для цитаты —
// текст, путь, действующая ли, день редакции, состояние акта; прежняя версия остаётся доступной по id; день первой редакции.
import { readFileSync } from "node:fs";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { START_CATALOG } from "../domain/start-catalog.ts";
import { seedActs } from "../infrastructure/db/catalog.repo.ts";
import { makeLoadAct } from "./load-act.ts";
import { makeLookup } from "./lookup.ts";
import type { LegalSource } from "./ports.ts";

const page = (name: string): string =>
  readFileSync(new URL(`../__fixtures__/pravo-by/${name}`, import.meta.url), "utf8");

let db: TestDb;
const system = () => createSystemDb(db.pool);
const nk = page("Hk0900071.html");
const changedNk = nk.replace("в размере 216 белорусских", "в размере 217 белорусских");

let fetchedAt = new Date("2026-10-30T09:00:00Z");
let html = nk;
const source: LegalSource = {
  async fetchActText() {
    return { html, fetchedAt };
  },
};

async function versionId(pathKey: string, current: boolean): Promise<string> {
  const rows = await db.owner.query<{ id: string }>(
    "select v.id from legal_fragment_versions v join legal_fragments f on f.id = v.fragment_id where f.path_key = $1 and v.is_current = $2",
    [pathKey, current],
  );
  const id = rows.rows[0]?.id;
  if (id === undefined) throw new Error(`нет версии ${pathKey}`);
  return id;
}

beforeAll(async () => {
  db = await createTestDb();
  await seedActs(system(), START_CATALOG, "start-catalog");
  const load = makeLoadAct({
    system: system(),
    source: async () => source,
    clock: new FakeClock("2026-10-30T09:00:00Z"),
    log: memoryLogger().log,
    notifications: { notifyAdmins: async () => undefined },
  });
  await load("Hk0900071");
  // Вторая редакция через неделю: изменена одна статья.
  fetchedAt = new Date("2026-11-06T09:00:00Z");
  html = changedNk;
  await load("Hk0900071");
});
afterAll(async () => {
  await db.drop();
});

describe("LEGAL-05: версия фрагмента для цитаты", () => {
  it("действующая версия: текст сохранённой редакции, путь, ссылка на pravo.by, день — снимок действующей редакции", async () => {
    const lookup = makeLookup({ system: system() });
    const [c] = await lookup.citations([await versionId("a209/p1.1", true)]);
    expect(c).toMatchObject({
      pravoId: "Hk0900071",
      pathKey: "a209/p1.1",
      articleNo: "209",
      isCurrent: true,
      excluded: false,
      actStatus: "active",
      hasText: true,
      editionOn: "2026-11-06",
      url: "https://pravo.by/document/?guid=3871&p0=Hk0900071",
    });
    expect(c?.text).toContain("в размере 217 белорусских");
    expect(c?.path).toContain("Статья 209");
  });

  it("CHAT-10: прежняя версия по id остаётся: старый текст, не действующая, день — последний снимок, где она была", async () => {
    const lookup = makeLookup({ system: system() });
    const [old] = await lookup.citations([await versionId("a209/p1.1", false)]);
    expect(old).toMatchObject({ isCurrent: false, editionOn: "2026-10-30" });
    expect(old?.text).toContain("в размере 216 белорусских");
  });

  it("неизменённая статья продлена: её день — действующая редакция акта", async () => {
    const lookup = makeLookup({ system: system() });
    const [c] = await lookup.citations([await versionId("a210", true)]);
    expect(c?.editionOn).toBe("2026-11-06");
  });

  it("порядок — как в запросе, неизвестный id пропускается", async () => {
    const lookup = makeLookup({ system: system() });
    const a = await versionId("a210", true);
    const b = await versionId("a209/p1.1", true);
    const out = await lookup.citations([b, "019e0000-0000-7000-8000-0000000000ff", a]);
    expect(out.map((c) => c.versionId)).toEqual([b, a]);
    expect(await lookup.citations([])).toEqual([]);
  });

  it("исключённая статья приходит со статусом «исключена»; утративший силу и исключённый админом акты — со своим статусом", async () => {
    const lookup = makeLookup({ system: system() });
    const excluded = await db.owner.query<{ id: string }>(
      "select v.id from legal_fragment_versions v join legal_fragments f on f.id = v.fragment_id where f.path_key = 'a113' and v.excluded",
    );
    const excludedId = excluded.rows[0]?.id ?? "";
    expect((await lookup.citations([excludedId]))[0]).toMatchObject({
      excluded: true,
      articleNo: "113",
    });
    const some = await versionId("a210", true);
    await db.owner.query(
      "update legal_acts set status = 'repealed', repealed_on = '2026-12-01' where pravo_id = 'Hk0900071'",
    );
    expect((await lookup.citations([some]))[0]).toMatchObject({
      actStatus: "repealed",
      repealedOn: "2026-12-01",
    });
    await db.owner.query("update legal_acts set status = 'excluded' where pravo_id = 'Hk0900071'");
    expect((await lookup.citations([some]))[0]?.actStatus).toBe("excluded");
    await db.owner.query(
      "update legal_acts set status = 'active', repealed_on = null where pravo_id = 'Hk0900071'",
    );
  });
});

describe("LEGAL-08: день первой редакции", () => {
  it("раньше первого применённого снимка прежней редакции нет: день — 30.10.2026, а не второй снимок", async () => {
    const lookup = makeLookup({ system: system() });
    expect(await lookup.firstEditionOn("Hk0900071")).toBe("2026-10-30");
  });

  it("у акта без снимков (только карточка) и неизвестного акта — null", async () => {
    const lookup = makeLookup({ system: system() });
    expect(await lookup.firstEditionOn("C20200778")).toBeNull();
    expect(await lookup.firstEditionOn("Zzzzzzzz9")).toBeNull();
  });
});
