// PRIV-02 на Postgres: облачное согласие дают и отзывают в настройках — новая строка журнала с версией и моментом,
// режим для админки (privacy_modes) и событие одной транзакцией; источник согласия видит отзыв сразу; устаревшая
// версия текста — CONFLICT без записи; история — только своя, новые сверху.
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../platform/db/scoped-db.ts";
import type { EventDef } from "../../../platform/events/define-event.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { makeCloudConsentSource } from "./cloud-consent.ts";
import { makeCloudConsentSettings } from "./cloud-consent-settings.ts";
import { makeRecordRegistrationConsents } from "./record-registration-consents.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

function setup() {
  const clock = new FakeClock("2026-10-26T09:00:00Z");
  const published: { name: string; payload: unknown }[] = [];
  const events = {
    publish: async (_tx: unknown, event: EventDef, payload: unknown) => {
      published.push({ name: event.name, payload });
    },
  };
  const settings = makeCloudConsentSettings({ clock, events, log: memoryLogger().log });
  const register = makeRecordRegistrationConsents({ clock, events });
  return { clock, published, settings, register };
}

async function modeRow(userId: string) {
  return (
    await db.owner.query<{ cloud: boolean; updated_at: Date }>(
      "select cloud, updated_at from privacy_modes where user_id = $1",
      [userId],
    )
  ).rows;
}

const version = CONSENT_VERSIONS.cloud;

describe("PRIV-02: облачное согласие в настройках", () => {
  it("регистрация без облака — режим «локальный»; дал согласие — «облачный с момента решения», событие", async () => {
    const { clock, published, settings, register } = setup();
    const scope = testScope({ user: 1, household: 1 });
    const s = createScopedDb(db.pool, scope);
    await register(s, {
      personalData: { accepted: true, version: CONSENT_VERSIONS.personalData },
      cloud: { accepted: false, version },
    });
    expect(await modeRow(scope.userId)).toEqual([
      { cloud: false, updated_at: new Date("2026-10-26T09:00:00Z") },
    ]);
    expect((await settings.state(s)).cloud).toEqual({
      granted: false,
      since: undefined,
      outdated: false,
    });

    clock.set("2026-10-27T12:30:00Z");
    const state = await settings.setCloudConsent(s, { granted: true, version });
    expect(state.cloud).toEqual({
      granted: true,
      since: new Date("2026-10-27T12:30:00Z"),
      outdated: false,
    });
    expect(state.history.map((r) => [r.kind, r.granted])).toEqual([
      ["cloud", true],
      ["cloud", false],
      ["personal-data", true],
    ]);
    expect(await modeRow(scope.userId)).toEqual([
      { cloud: true, updated_at: new Date("2026-10-27T12:30:00Z") },
    ]);
    expect(published.at(-1)).toEqual({
      name: "privacy.consent-changed",
      payload: { ids: [state.history[0]?.id] },
    });
  });

  it("отзыв действует на следующий же вызов источника согласия; режим — локальный", async () => {
    const { settings } = setup();
    const scope = testScope({ user: 2, household: 2 });
    const s = createScopedDb(db.pool, scope);
    const source = makeCloudConsentSource({ scoped: (sc) => createScopedDb(db.pool, sc) });
    await settings.setCloudConsent(s, { granted: true, version });
    expect(await source(scope)).toBe(true);
    await settings.setCloudConsent(s, { granted: false, version });
    expect(await source(scope)).toBe(false);
    expect((await modeRow(scope.userId)).map((r) => r.cloud)).toEqual([false]);
  });

  it("T-023: согласие по прежнему тексту не действует — условия обновились, облако выключено до повторного", async () => {
    const { settings } = setup();
    const scope = testScope({ user: 6, household: 6 });
    const s = createScopedDb(db.pool, scope);
    const source = makeCloudConsentSource({ scoped: (sc) => createScopedDb(db.pool, sc) });
    await db.owner.query(
      `insert into privacy_consents (household_id, user_id, kind, granted, text_version, created_at)
       values ($1, $2, 'cloud', true, '2026-10-26', '2026-10-20T09:00:00Z')`,
      [scope.householdId, scope.userId],
    );
    expect(await source(scope)).toBe(false);
    expect((await settings.state(s)).cloud).toEqual({
      granted: false,
      since: undefined,
      outdated: true,
    });
    // Повторное согласие по новому тексту возвращает облако.
    await settings.setCloudConsent(s, { granted: true, version });
    expect(await source(scope)).toBe(true);
    expect((await settings.state(s)).cloud).toMatchObject({ granted: true, outdated: false });
  });

  it("T-023: отозванное согласие по прежнему тексту — не «условия обновились»: облако и не включалось", async () => {
    const { settings } = setup();
    const scope = testScope({ user: 7, household: 7 });
    const s = createScopedDb(db.pool, scope);
    await db.owner.query(
      `insert into privacy_consents (household_id, user_id, kind, granted, text_version, created_at)
       values ($1, $2, 'cloud', false, '2026-10-26', '2026-10-20T09:00:00Z')`,
      [scope.householdId, scope.userId],
    );
    expect((await settings.state(s)).cloud.outdated).toBe(false);
  });

  it("версия текста устарела — CONFLICT, журнал, режим и события не тронуты", async () => {
    const { published, settings } = setup();
    const scope = testScope({ user: 3, household: 3 });
    const s = createScopedDb(db.pool, scope);
    await expect(
      settings.setCloudConsent(s, { granted: true, version: "2020-01-01" }),
    ).rejects.toMatchObject({ code: "CONFLICT", params: { reason: "consent-version" } });
    expect((await settings.state(s)).history).toEqual([]);
    expect(await modeRow(scope.userId)).toEqual([]);
    expect(published).toEqual([]);
  });

  it("история — только решения своего домохозяйства", async () => {
    const { settings } = setup();
    await settings.setCloudConsent(createScopedDb(db.pool, testScope({ user: 4, household: 4 })), {
      granted: true,
      version,
    });
    const other = createScopedDb(db.pool, testScope({ user: 5, household: 5 }));
    expect((await settings.state(other)).history).toEqual([]);
  });
});
