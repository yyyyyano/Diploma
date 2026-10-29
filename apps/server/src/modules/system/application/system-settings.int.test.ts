// ADM-60, NFR-23, NFR-24, OBS-05 на Postgres: часовой пояс из админки меняет «сегодня» сразу (часы — FakeClock по
// настройке clock.time-zone, как createClock в корне композиции); неизвестный пояс — VALIDATION; доступ из сети
// переключается вместе с адресом, неверный или пустой при включении адрес — VALIDATION, доступ не тронут; Langfuse — включён ли и где.
import { LocalDate } from "@kosht/kernel";
import { FakeClock, InlineJobs } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { ALLOW_LAN } from "../../../platform/http/allow-lan.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { createSettings } from "../../../platform/settings/settings.ts";
import { TIME_ZONE } from "../../../platform/settings/time-zone.ts";
import { createTelemetry } from "../../../platform/telemetry/telemetry.ts";
import { makeSystemSettings } from "./system-settings.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});
beforeEach(async () => {
  await db.owner.query("delete from settings");
});

function setup(langfuse = false) {
  // 21:30 UTC — в Минске (UTC+3) уже 22.10, в Лос-Анджелесе ещё 21.10.
  const fake = new FakeClock("2026-10-21T21:30:00Z");
  const { log } = memoryLogger();
  const settings = createSettings({
    db: createSystemDb(db.pool),
    clock: fake,
    env: () => undefined,
    log,
  });
  const today = () => LocalDate.fromInstant(fake.now(), settings.peek(TIME_ZONE));
  const system = makeSystemSettings({
    settings,
    log,
    jobs: new InlineJobs(() => undefined),
    telemetry: createTelemetry(
      langfuse
        ? { baseUrl: "http://127.0.0.1:3001", publicKey: "pk", secretKey: () => "sk" }
        : undefined,
    ),
  });
  return { settings, system, today };
}

describe("NFR-23: часовой пояс из админки", () => {
  it("смена пояса сразу меняет «сегодня» этого процесса", async () => {
    const { system, today } = setup();
    expect(today()).toBe("2026-10-22");
    await system.setTimeZone("America/Los_Angeles");
    expect(today()).toBe("2026-10-21");
    expect((await system.view()).timeZone).toBe("America/Los_Angeles");
  });

  it("неизвестный пояс — VALIDATION, прежний остаётся", async () => {
    const { system, today } = setup();
    await expect(system.setTimeZone("Mars/Olympus")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(today()).toBe("2026-10-22");
  });
});

describe("NFR-24: доступ с других устройств", () => {
  it("включение и адрес для ссылок сохраняются; выключение — сразу", async () => {
    const { system, settings } = setup();
    await system.setLan({ allowed: true, address: "http://192.168.1.5:8141" });
    expect((await system.view()).lan).toEqual({
      allowed: true,
      address: "http://192.168.1.5:8141",
    });
    await system.setLan({ allowed: false, address: "" });
    expect(await settings.get(ALLOW_LAN)).toBe(false);
  });

  it("включить доступ без адреса — VALIDATION, доступ не открыт: ссылкам в письмах не на что опираться", async () => {
    const { system, settings } = setup();
    await expect(system.setLan({ allowed: true, address: "" })).rejects.toMatchObject({
      code: "VALIDATION",
      params: { setting: "network.lan-address" },
    });
    expect(await settings.get(ALLOW_LAN)).toBe(false);
  });

  it("адрес не http(s) — VALIDATION, доступ не переключён", async () => {
    const { system, settings } = setup();
    await expect(
      system.setLan({ allowed: true, address: "javascript:alert(1)" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await settings.get(ALLOW_LAN)).toBe(false);
  });
});

describe("OBS-05: статус Langfuse", () => {
  it("выключен — без адреса; включён — адрес интерфейса", async () => {
    expect((await setup(false).system.view()).langfuse).toEqual({ enabled: false, url: null });
    expect((await setup(true).system.view()).langfuse).toEqual({
      enabled: true,
      url: "http://127.0.0.1:3001",
    });
  });
});
