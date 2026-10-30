// LAW-30, LAW-38, NFR-22 на Postgres: проход по загруженным актам — неизменённые пропускаются, изменённый получает
// новую редакцию, остановка загрузчика — уведомление и повторяемая ошибка; векторизуются только новые версии.
import { readFileSync } from "node:fs";
import { FakeClock, hashEmbedder } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { START_CATALOG } from "../domain/start-catalog.ts";
import { seedActs } from "../infrastructure/db/catalog.repo.ts";
import { makeDailyCheck } from "./daily-check.ts";
import { makeEmbedder } from "./embed.ts";
import { makeLoadAct } from "./load-act.ts";
import { ActTextNotFound, LoaderStopped, type LegalSource } from "./ports.ts";

const page = (name: string): string =>
  readFileSync(new URL(`../__fixtures__/pravo-by/${name}`, import.meta.url), "utf8");

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await seedActs(createSystemDb(db.pool), START_CATALOG, "start-catalog");
});
afterAll(async () => {
  await db.drop();
});

describe("LAW-30: ежедневная проверка", () => {
  it("неизменённые акты пропускаются, изменённый — новая редакция и вектор только у новой версии; остановка — уведомление", async () => {
    const clock = new FakeClock("2026-10-30T09:00:00Z");
    const pages: Record<string, string> = {
      H10200090: page("H10200090.html"),
      Hk0900071: page("Hk0900071.html"),
    };
    let stop = false;
    const source: LegalSource = {
      async fetchActText(id) {
        if (stop) throw new LoaderStopped("LOADER_BLOCKED");
        const html = pages[id];
        if (html === undefined) throw new ActTextNotFound();
        return { html, fetchedAt: clock.now() };
      },
    };
    const notified: string[] = [];
    const system = createSystemDb(db.pool);
    const loadAct = makeLoadAct({
      system,
      source: async () => source,
      clock,
      log: memoryLogger().log,
      notifications: { notifyAdmins: async () => undefined },
    });
    await loadAct("H10200090");
    await loadAct("Hk0900071");
    const fake = hashEmbedder(1024);
    const embedded: string[] = [];
    const embedder = makeEmbedder({
      system,
      embed: async (texts) => {
        embedded.push(...texts);
        return fake.embed(texts);
      },
      clock,
      log: memoryLogger().log,
    });
    await embedder.run();
    const check = makeDailyCheck({
      system,
      loadAct,
      embedder,
      clock,
      log: memoryLogger().log,
      notifications: {
        notifyAdmins: async (input) => {
          notified.push(input.key);
          return undefined;
        },
      },
    });

    embedded.length = 0;
    const same = await check();
    expect(same).toMatchObject({ unchanged: 2, changed: 0 });
    expect(embedded).toHaveLength(0);

    pages["H10200090"] = page("H10200090.html").replace(
      "Основные термины и их определения",
      "Основные термины и определения",
    );
    const next = await check();
    expect(next).toMatchObject({ unchanged: 1, changed: 1 });
    expect(embedded).toHaveLength(1);

    stop = true;
    await expect(check()).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(notified).toEqual([`loader-stopped:LOADER_BLOCKED:${clock.today()}`]);
  });
});
