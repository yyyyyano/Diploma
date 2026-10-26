// Запросы identity на Postgres: занятый email при вставке (гонка регистраций) — EMAIL_TAKEN, а не ошибка базы;
// владелец новой сессии — домохозяйство и статус; неизвестный пользователь — undefined/false.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb, type SystemDb } from "../../../../platform/db/system-db.ts";
import {
  insertUser,
  markEmailVerified,
  newUserIds,
  sessionOwner,
  userCard,
} from "./identity.repo.ts";

let db: TestDb;
let system: SystemDb;
beforeAll(async () => {
  db = await createTestDb();
  system = createSystemDb(db.pool);
});
afterAll(async () => {
  await db.drop();
});

const unknown = "0199f0a0-0000-7000-8000-0000000000aa";

describe("identity.repo", () => {
  it("второй пользователь с тем же email — EMAIL_TAKEN, первый не тронут", async () => {
    const user = { email: "same@example.test", role: "user", passwordHash: "x" } as const;
    await insertUser(system, { ...(await newUserIds(system)), ...user });
    await expect(
      insertUser(system, { ...(await newUserIds(system)), ...user }),
    ).rejects.toMatchObject({
      code: "EMAIL_TAKEN",
    });
    const { rows } = await db.owner.query(
      "select 1 from identity_users where email = 'same@example.test'",
    );
    expect(rows).toHaveLength(1);
  });

  it("владелец сессии: домохозяйство и статус; заблокированный — blocked; неизвестный — undefined", async () => {
    const ids = await newUserIds(system);
    await insertUser(system, {
      ...ids,
      email: "owner@example.test",
      role: "user",
      passwordHash: "x",
    });
    expect(await sessionOwner(system, ids.userId)).toEqual({
      householdId: ids.householdId,
      status: "active",
    });
    await db.owner.query("update identity_users set status = 'blocked' where id = $1", [
      ids.userId,
    ]);
    expect(await sessionOwner(system, ids.userId)).toEqual({
      householdId: ids.householdId,
      status: "blocked",
    });
    expect(await sessionOwner(system, unknown)).toBeUndefined();
  });

  it("неизвестный пользователь: карточки нет, отметить адрес нельзя", async () => {
    expect(await userCard(system, unknown as never)).toBeUndefined();
    expect(await markEmailVerified(system, unknown, new Date("2026-10-26T09:00:00Z"))).toBe(false);
  });
});
