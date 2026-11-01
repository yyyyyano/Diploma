// PRIV-08 на Postgres: согласие на Telegram — отдельный вид журнала, не связанный с облачным; дать (версия по действующему
// тексту), отозвать, устаревшая версия — CONFLICT без записи; чужое домохозяйство решения не видит.
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../platform/db/scoped-db.ts";
import type { EventDef } from "../../../platform/events/define-event.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { makeCloudConsentSettings } from "./cloud-consent-settings.ts";
import { makeTelegramConsent } from "./telegram-consent.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

function setup() {
  const published: string[] = [];
  const events = {
    publish: async (_tx: unknown, event: EventDef) => {
      published.push(event.name);
    },
  };
  const deps = { clock: new FakeClock("2026-11-01T09:00:00Z"), events, log: memoryLogger().log };
  return { published, telegram: makeTelegramConsent(deps), cloud: makeCloudConsentSettings(deps) };
}

describe("PRIV-08", () => {
  it("дал согласие — действует; отозвал — нет; в журнале обе строки с версией и событием", async () => {
    const { published, telegram, cloud } = setup();
    const s = createScopedDb(db.pool, testScope({ user: 1, household: 1 }));
    expect(await telegram.given(s)).toBe(false);
    await telegram.set(s, { granted: true, version: CONSENT_VERSIONS.telegram });
    expect(await telegram.given(s)).toBe(true);
    await telegram.set(s, { granted: false, version: CONSENT_VERSIONS.telegram });
    expect(await telegram.given(s)).toBe(false);
    expect(published).toEqual(["privacy.consent-changed", "privacy.consent-changed"]);
    const history = (await cloud.state(s)).history;
    expect(history.map((row) => [row.kind, row.granted, row.textVersion])).toEqual([
      ["telegram", false, CONSENT_VERSIONS.telegram],
      ["telegram", true, CONSENT_VERSIONS.telegram],
    ]);
  });

  it("согласие на Telegram не включает облако", async () => {
    const { telegram, cloud } = setup();
    const s = createScopedDb(db.pool, testScope({ user: 2, household: 2 }));
    await telegram.set(s, { granted: true, version: CONSENT_VERSIONS.telegram });
    expect((await cloud.state(s)).cloud.granted).toBe(false);
  });

  it("устаревшая версия текста — CONFLICT, строка не записана", async () => {
    const { telegram, cloud } = setup();
    const s = createScopedDb(db.pool, testScope({ user: 3, household: 3 }));
    await expect(telegram.set(s, { granted: true, version: "2020-01-01" })).rejects.toMatchObject({
      message: "CONFLICT",
    });
    expect((await cloud.state(s)).history).toEqual([]);
  });

  it("чужое домохозяйство согласия не видит", async () => {
    const { telegram } = setup();
    const a = createScopedDb(db.pool, testScope({ user: 4, household: 4 }));
    const b = createScopedDb(db.pool, testScope({ user: 5, household: 5 }));
    await telegram.set(a, { granted: true, version: CONSENT_VERSIONS.telegram });
    expect(await telegram.given(b)).toBe(false);
  });
});
