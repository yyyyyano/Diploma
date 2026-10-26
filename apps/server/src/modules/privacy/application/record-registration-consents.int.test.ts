// PRIV-01, PRIV-02, AUTH-02: согласия на Postgres — пишутся с версией текста и моментом, событие consent-changed с id
// строк; устаревшая версия — CONFLICT; источник облачного согласия видит последнее решение сразу (без кэша).
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../platform/db/scoped-db.ts";
import type { EventDef } from "../../../platform/events/define-event.ts";
import { insertConsents } from "../infrastructure/db/consents.repo.ts";
import { makeCloudConsentSource } from "./cloud-consent.ts";
import { makeRecordRegistrationConsents } from "./record-registration-consents.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const clock = new FakeClock("2026-10-26T09:00:00Z");

function recorder() {
  const published: { name: string; payload: unknown }[] = [];
  const record = makeRecordRegistrationConsents({
    clock,
    events: {
      publish: async (_tx, event: EventDef, payload) => {
        published.push({ name: event.name, payload });
      },
    },
  });
  return { record, published };
}

const consents = (cloud: boolean, version: string = CONSENT_VERSIONS.cloud) => ({
  personalData: { accepted: true as const, version: CONSENT_VERSIONS.personalData },
  cloud: { accepted: cloud, version },
});

async function rows(householdId: string) {
  return (
    await db.owner.query<{
      id: string;
      kind: string;
      granted: boolean;
      text_version: string;
      created_at: Date;
    }>(
      "select id, kind, granted, text_version, created_at from privacy_consents where household_id = $1 order by kind",
      [householdId],
    )
  ).rows;
}

describe("PRIV-01, PRIV-02: согласия при регистрации", () => {
  it("ПД — дано, облако — отказ: две строки с версией текста и временем, событие с их id", async () => {
    const scope = testScope({ user: 1, household: 1 });
    const { record, published } = recorder();
    await record(createScopedDb(db.pool, scope), consents(false));
    const saved = await rows(scope.householdId);
    expect(saved).toEqual([
      {
        id: expect.any(String),
        kind: "cloud",
        granted: false,
        text_version: CONSENT_VERSIONS.cloud,
        created_at: new Date("2026-10-26T09:00:00Z"),
      },
      {
        id: expect.any(String),
        kind: "personal-data",
        granted: true,
        text_version: CONSENT_VERSIONS.personalData,
        created_at: new Date("2026-10-26T09:00:00Z"),
      },
    ]);
    expect(published).toEqual([
      {
        name: "privacy.consent-changed",
        payload: { ids: expect.arrayContaining(saved.map((r) => r.id)) },
      },
    ]);
  });

  it("версия текста устарела — CONFLICT, ничего не записано", async () => {
    const scope = testScope({ user: 2, household: 2 });
    const { record, published } = recorder();
    await expect(
      record(createScopedDb(db.pool, scope), consents(true, "2020-01-01")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await rows(scope.householdId)).toEqual([]);
    expect(published).toEqual([]);
  });
});

describe("PRIV-02: источник облачного согласия", () => {
  const source = makeCloudConsentSource({ scoped: (scope) => createScopedDb(db.pool, scope) });

  it("решений нет — облако запрещено", async () => {
    expect(await source(testScope({ user: 3, household: 3 }))).toBe(false);
  });

  it("дал согласие — разрешено; отозвал — запрещено на следующем же вызове", async () => {
    const scope = testScope({ user: 4, household: 4 });
    const s = createScopedDb(db.pool, scope);
    await recorder().record(s, consents(true));
    expect(await source(scope)).toBe(true);
    await insertConsents(
      s,
      [{ kind: "cloud", granted: false, textVersion: CONSENT_VERSIONS.cloud }],
      new Date("2026-10-26T10:00:00Z"),
    );
    expect(await source(scope)).toBe(false);
  });

  it("согласие другого домохозяйства не действует", async () => {
    await recorder().record(
      createScopedDb(db.pool, testScope({ user: 5, household: 5 })),
      consents(true),
    );
    expect(await source(testScope({ user: 6, household: 6 }))).toBe(false);
  });
});
