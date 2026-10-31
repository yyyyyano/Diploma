// LAW-35 на настоящем Postgres и настоящем времени: два загрузчика (как две фоновые задачи — догрузка по требованию и
// ночная проверка) на одной БД не шлют запросы одновременно, и между концом одного запроса и началом следующего
// проходит не меньше паузы, даже когда ответ идёт дольше паузы. Сеть не используется — поддельный fetch.
import { LocalDate } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../../platform/logging/__fixtures__/memory-logger.ts";
import { makeLoaderStore } from "../db/loader.repo.ts";
import { createPoliteFetcher } from "./polite-fetcher.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const PAUSE_MS = 60;
/** Ответ страницы идёт заметно дольше паузы — как НК на медленном канале. */
const RESPONSE_MS = 250;

describe("LAW-35: без параллельных запросов — для всех задач на одной БД", () => {
  it("интервалы запросов двух загрузчиков не пересекаются, между ними — не меньше паузы", async () => {
    const intervals: { start: number; end: number }[] = [];
    const fakeFetch = (async (input: URL | string) => {
      const start = performance.now();
      if (!String(input).endsWith("/robots.txt")) await sleep(RESPONSE_MS);
      intervals.push({ start, end: performance.now() });
      return String(input).endsWith("/robots.txt")
        ? new Response("", { status: 404 })
        : new Response("<html>", { status: 200 });
    }) as typeof fetch;
    const loader = () =>
      createPoliteFetcher({
        fetch: fakeFetch,
        clock: { now: () => new Date(), today: () => LocalDate.parse("2026-10-31") },
        sleep: (ms, signal) => sleep(ms, undefined, signal === undefined ? {} : { signal }),
        random: () => 0,
        contact: async () => "operator@example.test",
        settings: async () => ({
          pauseMinMs: PAUSE_MS,
          pauseMaxMs: PAUSE_MS,
          timeoutMs: 5000,
          maxPageBytes: 1_000_000,
        }),
        store: makeLoaderStore(createSystemDb(db.pool)),
        log: memoryLogger().log,
      });
    const [a, b] = [loader(), loader()];
    await Promise.all([
      a.get(new URL("https://pravo.by/document/?p0=H10200090")),
      b.get(new URL("https://pravo.by/document/?p0=H10200091")),
      a.get(new URL("https://pravo.by/document/?p0=H10200092")),
      b.get(new URL("https://pravo.by/document/?p0=H10200093")),
    ]);
    const sorted = [...intervals].sort((x, y) => x.start - y.start);
    expect(sorted.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < sorted.length; i += 1) {
      // Допуск 2 мс — округление Date (ms) против performance.now() (доли ms).
      expect(sorted[i]!.start - sorted[i - 1]!.end).toBeGreaterThanOrEqual(PAUSE_MS - 2);
    }
  });
});
