import { FakeClock } from "@kosht/testing";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createSystemDb } from "../db/system-db.ts";
import { AppError } from "../errors/app-error.ts";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import { createSettings, defineSetting, SETTINGS_CACHE_MS, type Settings } from "./settings.ts";
import { TIME_ZONE } from "./time-zone.ts";

const LIMIT = defineSetting({
  key: "test.import-limit",
  schema: z.number().int().min(1).max(1000),
  default: 300,
  env: "TEST_IMPORT_LIMIT",
  fromEnv: Number,
});

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.pool.query("delete from settings");
});

/** Процесс со своими часами, окружением и кэшем — как api и worker. */
function startProcess(
  env: Record<string, string> = {},
  clock = new FakeClock("2026-10-21T09:00:00Z"),
) {
  const logs = memoryLogger();
  const settings: Settings = createSettings({
    db: createSystemDb(db.pool),
    clock,
    env: (name) => env[name],
    log: logs.log,
  });
  return { settings, clock, logs };
}

describe("ADM-60, NFR-16: приоритет «админка > env > умолчание»", () => {
  it("ничего не задано — умолчание", async () => {
    const { settings } = startProcess();
    expect(await settings.get(LIMIT)).toBe(300);
    expect(await settings.source(LIMIT)).toBe("default");
  });

  it("задана переменная окружения — значение из env", async () => {
    const { settings } = startProcess({ TEST_IMPORT_LIMIT: "500" });
    expect(await settings.get(LIMIT)).toBe(500);
    expect(await settings.source(LIMIT)).toBe("env");
  });

  it("задано в админке — оно важнее env; сброс возвращает env", async () => {
    const { settings } = startProcess({ TEST_IMPORT_LIMIT: "500" });
    await settings.set(LIMIT, 700);
    expect(await settings.get(LIMIT)).toBe(700);
    expect(await settings.source(LIMIT)).toBe("admin");
    await settings.reset(LIMIT);
    expect(await settings.get(LIMIT)).toBe(500);
  });

  it("неверное значение не записывается: VALIDATION с ключом настройки, без значения", async () => {
    const { settings } = startProcess();
    const attempt = settings.set(LIMIT, 5000);
    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({
      code: "VALIDATION",
      params: { setting: "test.import-limit" },
    });
    expect((await db.pool.query("select * from settings")).rowCount).toBe(0);
  });

  it("неверное в env — пропускается со строкой в логе, действует умолчание", async () => {
    const { settings, logs } = startProcess({ TEST_IMPORT_LIMIT: "много" });
    expect(await settings.get(LIMIT)).toBe(300);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ msg: "settings.env-invalid", setting: "test.import-limit" }),
    );
    expect(logs.text()).not.toContain("много");
  });

  it("неверное в базе (записано в обход) — пропускается, действует env", async () => {
    await db.pool.query("insert into settings (key, value, updated_at) values ($1, $2, now())", [
      "test.import-limit",
      JSON.stringify("не число"),
    ]);
    const { settings, logs } = startProcess({ TEST_IMPORT_LIMIT: "500" });
    expect(await settings.get(LIMIT)).toBe(500);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ msg: "settings.stored-invalid" }),
    );
  });
});

describe("ARCHITECTURE §9: кэш не дольше 5 с", () => {
  it("значение, заданное другим процессом, видно не позже чем через 5 с", async () => {
    const api = startProcess();
    const worker = startProcess();
    expect(await api.settings.get(LIMIT)).toBe(300);
    await worker.settings.set(LIMIT, 42);
    api.clock.advance(SETTINGS_CACHE_MS - 1);
    expect(await api.settings.get(LIMIT)).toBe(300);
    api.clock.advance(1);
    expect(await api.settings.get(LIMIT)).toBe(42);
  });

  it("свой set виден сразу", async () => {
    const { settings } = startProcess();
    expect(await settings.get(LIMIT)).toBe(300);
    await settings.set(LIMIT, 7);
    expect(await settings.get(LIMIT)).toBe(7);
  });

  it("peek синхронно отдаёт известное значение и обновляет устаревшее в фоне", async () => {
    const api = startProcess({ TEST_IMPORT_LIMIT: "500" });
    expect(api.settings.peek(LIMIT)).toBe(500);
    await startProcess().settings.set(LIMIT, 9);
    await expect.poll(() => api.settings.peek(LIMIT)).toBe(500);
    api.clock.advance(SETTINGS_CACHE_MS);
    api.settings.peek(LIMIT);
    await expect.poll(() => api.settings.peek(LIMIT)).toBe(9);
  });
});

describe("NFR-23: настройка «часовой пояс»", () => {
  it("по умолчанию Минск, неверный пояс в админке отвергается, верный — принимается", async () => {
    const { settings } = startProcess();
    expect(await settings.get(TIME_ZONE)).toBe("Europe/Minsk");
    await expect(settings.set(TIME_ZONE, "Mars/Olympus")).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await settings.set(TIME_ZONE, "UTC");
    expect(await settings.get(TIME_ZONE)).toBe("UTC");
  });

  it("неверный пояс из env отвергается при чтении — Минск", async () => {
    const { settings } = startProcess({ TIME_ZONE: "Europe/Минск" });
    expect(await settings.get(TIME_ZONE)).toBe("Europe/Minsk");
  });
});

describe("defineSetting", () => {
  it("ключ не по форме, повтор ключа и умолчание не по схеме — ошибка регистрации", () => {
    expect(() => defineSetting({ key: "Bad Key", schema: z.string(), default: "" })).toThrow(
      RangeError,
    );
    expect(() => defineSetting({ ...LIMIT })).toThrow(/объявлена дважды/);
    expect(() =>
      defineSetting({ key: "test.bad-default", schema: z.number().min(1), default: 0 }),
    ).toThrow(/не проходит её схему/);
    expect(() =>
      defineSetting({ key: "test.bad-env", schema: z.string(), default: "", env: "lower" }),
    ).toThrow(RangeError);
  });
});

describe("находка T-007: ключ часового пояса — clock.time-zone", () => {
  it("миграция переносит пояс, заданный в админке под старым ключом system.time-zone", async () => {
    await db.owner.query(
      `insert into settings (key, value, updated_at) values ('system.time-zone', '"Europe/Vilnius"', now())`,
    );
    const dir = fileURLToPath(new URL("../../../drizzle/", import.meta.url));
    const migration = readdirSync(dir).find((name) => name.endsWith("_clock-time-zone-key"));
    if (migration === undefined) throw new Error("нет миграции clock-time-zone-key");
    await db.owner.query(readFileSync(join(dir, migration, "migration.sql"), "utf8"));
    const { settings } = startProcess();
    expect(TIME_ZONE.key).toBe("clock.time-zone");
    expect(await settings.get(TIME_ZONE)).toBe("Europe/Vilnius");
    const { rows } = await db.owner.query("select key from settings order by key");
    expect(rows).toEqual([{ key: "clock.time-zone" }]);
  });
});
