// LAW-33: текст пункта статьи и вложенных частей действующей редакции — основа сверки чисел таблицы ставок с новой редакцией.
import { readFileSync } from "node:fs";
import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb, type SystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { START_CATALOG } from "../domain/start-catalog.ts";
import { seedActs } from "../infrastructure/db/catalog.repo.ts";
import { makeLoadAct } from "./load-act.ts";
import { makeLookup } from "./lookup.ts";

let db: TestDb;
let system: SystemDb;
beforeAll(async () => {
  db = await createTestDb();
  system = createSystemDb(db.pool);
  const clock = new FakeClock("2026-10-30T09:00:00Z");
  await seedActs(system, START_CATALOG, "start-catalog");
  const html = readFileSync(
    new URL("../__fixtures__/pravo-by/Hk0900071.html", import.meta.url),
    "utf8",
  );
  const load = makeLoadAct({
    system,
    source: async () => ({ fetchActText: async () => ({ html, fetchedAt: clock.now() }) }),
    clock,
    log: memoryLogger().log,
    notifications: { notifyAdmins: async () => undefined } as never,
  });
  await load("Hk0900071");
});
afterAll(async () => {
  await db.drop();
});

describe("LAW-33: фрагменты пункта и вложенных частей", () => {
  it("пункт 1.2 статьи 209 — сам и его части: число 63 в пункте, число 120 в части; другие пункты не попадают", async () => {
    const found = await makeLookup({ system }).fragmentsUnder("Hk0900071", "a209/p1.2");
    const keys = found.map((f) => f.pathKey);
    expect(keys[0]).toBe("a209/p1.2");
    expect(keys.every((k) => k === "a209/p1.2" || k.startsWith("a209/p1.2/"))).toBe(true);
    expect(found.some((f) => /\b63\b/u.test(f.text))).toBe(true);
    expect(found.some((f) => /\b120\b/u.test(f.text))).toBe(true);
    expect(found.some((f) => /\b306\b/u.test(f.text))).toBe(false);
  });

  it("нет такого пункта или акта — пусто", async () => {
    const lookup = makeLookup({ system });
    expect(await lookup.fragmentsUnder("Hk0900071", "a209/p9")).toEqual([]);
    expect(await lookup.fragmentsUnder("H19999999", "a209/p1.2")).toEqual([]);
  });

  it("исключённый администратором акт не отдаёт фрагментов", async () => {
    await db.owner.query("update legal_acts set status = 'excluded' where pravo_id = 'Hk0900071'");
    expect(await makeLookup({ system }).fragmentsUnder("Hk0900071", "a209/p1.2")).toEqual([]);
    await db.owner.query("update legal_acts set status = 'active' where pravo_id = 'Hk0900071'");
  });
});
