import { FakeClock } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../db/system-db.ts";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import { createSettings, type Settings } from "../settings/settings.ts";
import { ALLOW_LAN } from "./allow-lan.ts";
import { createApp } from "./app.ts";
import { createListeners, LAN_CHECK_MS, type Listeners } from "./listeners.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

/** Процесс со своими часами и кэшем настроек — как api и, например, worker. */
function processSettings(clock: FakeClock): Settings {
  return createSettings({
    db: createSystemDb(db.pool),
    clock,
    env: () => undefined,
    log: memoryLogger().log,
  });
}

function apiListeners(settings: Settings): Listeners {
  const log = memoryLogger().log;
  return createListeners({
    local: { host: "127.0.0.1", port: 0 },
    lan: { host: "127.0.0.1", port: 0 },
    allowLan: () => settings.get(ALLOW_LAN),
    log,
    fetch: (listener) =>
      createApp({ listener, trustedOrigins: [], log, ready: async () => {} }).fetch,
  });
}

describe("NFR-24: сетевой вход открывается и закрывается настройкой без перезапуска", () => {
  it("по умолчанию сетевой вход закрыт; админка этого процесса открывает и закрывает его на следующей сверке", async () => {
    const clock = new FakeClock("2026-10-21T09:00:00Z");
    const settings = processSettings(clock);
    const listeners = apiListeners(settings);
    try {
      await listeners.start();
      expect(listeners.address("lan")).toBeUndefined();

      await settings.set(ALLOW_LAN, true);
      clock.advance(LAN_CHECK_MS);
      await listeners.reconcile();
      const port = listeners.address("lan")?.port;
      expect(port).toBeDefined();
      const response = await fetch(`http://127.0.0.1:${String(port)}/healthz`);
      expect(response.status).toBe(200);

      await settings.set(ALLOW_LAN, false);
      clock.advance(LAN_CHECK_MS);
      await listeners.reconcile();
      expect(listeners.address("lan")).toBeUndefined();
      await expect(fetch(`http://127.0.0.1:${String(port)}/healthz`)).rejects.toThrow(
        "fetch failed",
      );
    } finally {
      await listeners.stop(0);
      await settings.reset(ALLOW_LAN);
    }
  });

  it("запись другим процессом видна не позднее 5 с (сверка раз в секунду, кэш настроек 5 с)", async () => {
    const clock = new FakeClock("2026-10-21T09:00:00Z");
    const api = processSettings(clock);
    const other = processSettings(new FakeClock("2026-10-21T09:00:00Z"));
    const listeners = apiListeners(api);
    try {
      await listeners.start();
      await other.set(ALLOW_LAN, true);

      let openedAfterMs: number | undefined;
      for (let elapsed = LAN_CHECK_MS; elapsed <= 10 * LAN_CHECK_MS; elapsed += LAN_CHECK_MS) {
        clock.advance(LAN_CHECK_MS);
        await listeners.reconcile();
        if (listeners.address("lan") !== undefined) {
          openedAfterMs = elapsed;
          break;
        }
      }
      expect(openedAfterMs).toBeDefined();
      expect(openedAfterMs).toBeLessThanOrEqual(5_000);
    } finally {
      await listeners.stop(0);
      await other.reset(ALLOW_LAN);
    }
  });
});
