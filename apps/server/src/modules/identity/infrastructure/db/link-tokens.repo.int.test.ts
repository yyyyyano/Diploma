// AUTH-03, AUTH-04: одноразовые ссылки на Postgres — гасится один раз, истёкшая и чужого назначения не гасятся,
// новая ссылка того же назначения гасит прежнюю, истёкшие строки убираются. Время — параметром (FakeClock не нужен).
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../../platform/db/system-db.ts";
import { consumeLinkToken, saveLinkToken } from "./link-tokens.repo.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const now = new Date("2026-10-26T09:00:00Z");
const hour = new Date("2026-10-26T10:00:00Z");

describe("AUTH-03, AUTH-04: ссылка из письма", () => {
  it("действующая ссылка гасится один раз и называет пользователя", async () => {
    const system = createSystemDb(db.pool);
    await saveLinkToken(system, {
      purpose: "reset-password",
      userId: "u-1",
      tokenHash: "h1",
      expiresAt: hour,
      now,
    });
    const link = { purpose: "reset-password", tokenHash: "h1", now } as const;
    expect(await consumeLinkToken(system, link)).toBe("u-1");
    expect(await consumeLinkToken(system, link)).toBeUndefined();
  });

  it("истёкшая ссылка не гасится", async () => {
    const system = createSystemDb(db.pool);
    await saveLinkToken(system, {
      purpose: "reset-password",
      userId: "u-2",
      tokenHash: "h2",
      expiresAt: hour,
      now,
    });
    expect(
      await consumeLinkToken(system, { purpose: "reset-password", tokenHash: "h2", now: hour }),
    ).toBeUndefined();
  });

  it("ссылка подтверждения адреса не годится для сброса пароля", async () => {
    const system = createSystemDb(db.pool);
    await saveLinkToken(system, {
      purpose: "verify-email",
      userId: "u-3",
      tokenHash: "h3",
      expiresAt: hour,
      now,
    });
    expect(
      await consumeLinkToken(system, { purpose: "reset-password", tokenHash: "h3", now }),
    ).toBeUndefined();
    expect(await consumeLinkToken(system, { purpose: "verify-email", tokenHash: "h3", now })).toBe(
      "u-3",
    );
  });

  it("новая ссылка гасит прежнюю того же назначения, но не другого; истёкшие строки удаляются", async () => {
    const system = createSystemDb(db.pool);
    const early = new Date("2026-10-26T08:00:00Z");
    await saveLinkToken(system, {
      purpose: "verify-email",
      userId: "u-4",
      tokenHash: "old",
      expiresAt: hour,
      now,
    });
    await saveLinkToken(system, {
      purpose: "reset-password",
      userId: "u-4",
      tokenHash: "rst",
      expiresAt: hour,
      now,
    });
    await saveLinkToken(system, {
      purpose: "verify-email",
      userId: "u-5",
      tokenHash: "gone",
      expiresAt: early,
      now: early,
    });
    await saveLinkToken(system, {
      purpose: "verify-email",
      userId: "u-4",
      tokenHash: "new",
      expiresAt: hour,
      now,
    });
    expect(
      await consumeLinkToken(system, { purpose: "verify-email", tokenHash: "old", now }),
    ).toBeUndefined();
    expect(
      await consumeLinkToken(system, { purpose: "reset-password", tokenHash: "rst", now }),
    ).toBe("u-4");
    const { rows } = await db.owner.query(
      "select identifier from identity_verifications where value = 'u-5'",
    );
    expect(rows).toEqual([]);
  });
});
