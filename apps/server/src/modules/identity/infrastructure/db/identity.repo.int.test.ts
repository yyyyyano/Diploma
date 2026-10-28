// Запросы identity на Postgres: занятый email при вставке (гонка регистраций) — EMAIL_TAKEN, а не ошибка базы;
// владелец новой сессии — домохозяйство и статус; неизвестный пользователь — undefined/false.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb, type SystemDb } from "../../../../platform/db/system-db.ts";
import {
  accountOf,
  adminResetMarkOf,
  deleteUserRecords,
  insertUser,
  listAccounts,
  lockUserStatus,
  markEmailVerified,
  newUserIds,
  passwordHashOf,
  sessionOwner,
  setAdminResetMark,
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

describe("PRIV-06: запись identity при удалении аккаунта", () => {
  it("хэш пароля — у пользователя с паролем; неизвестный — undefined", async () => {
    const ids = await newUserIds(system);
    await insertUser(system, {
      ...ids,
      email: "hash@example.test",
      role: "user",
      passwordHash: "h1",
    });
    expect(await passwordHashOf(system, ids.userId)).toBe("h1");
    expect(await passwordHashOf(system, unknown)).toBeUndefined();
  });

  it("домохозяйство с другим участником остаётся, последний участник уносит его с собой", async () => {
    const first = await newUserIds(system);
    await insertUser(system, {
      ...first,
      email: "first@example.test",
      role: "user",
      passwordHash: "x",
    });
    const second = await newUserIds(system);
    await db.owner.query(
      "insert into identity_users (id, name, email, household_id) values ($1, '', 'second@example.test', $2)",
      [second.userId, first.householdId],
    );
    const household = async () =>
      (await db.owner.query("select 1 from identity_households where id = $1", [first.householdId]))
        .rows.length;

    await deleteUserRecords(system, { userId: first.userId, householdId: first.householdId });
    expect(await userCard(system, first.userId)).toBeUndefined();
    expect(await household()).toBe(1);

    await deleteUserRecords(system, { userId: second.userId, householdId: first.householdId });
    expect(await household()).toBe(0);
  });
});

describe("ADM-30, AUTH-05: учётные записи для админки", () => {
  it("список и учётная запись — роль и статус как в базе; неизвестный — undefined, отметки нет", async () => {
    const admin = await newUserIds(system);
    await insertUser(system, {
      ...admin,
      email: "list-admin@example.test",
      role: "admin",
      passwordHash: "x",
    });
    await db.owner.query("update identity_users set status = 'blocked' where id = $1", [
      admin.userId,
    ]);
    const accounts = await listAccounts(system, 1000);
    expect(accounts.find((a) => a.id === admin.userId)).toMatchObject({
      email: "list-admin@example.test",
      role: "admin",
      status: "blocked",
      emailVerified: false,
      demo: false,
    });
    expect(await accountOf(system, admin.userId)).toMatchObject({
      role: "admin",
      status: "blocked",
      householdId: admin.householdId,
    });
    expect(await accountOf(system, unknown)).toBeUndefined();
    expect(await lockUserStatus(system, unknown)).toBeUndefined();
    expect(await adminResetMarkOf(system, unknown)).toBeNull();
  });

  it("отметка «сброшен администратором» ставится моментом и гасится", async () => {
    const user = await newUserIds(system);
    await insertUser(system, {
      ...user,
      email: "mark@example.test",
      role: "user",
      passwordHash: "x",
    });
    expect(await adminResetMarkOf(system, user.userId)).toBeNull();
    await setAdminResetMark(system, user.userId, new Date("2026-10-28T10:14:00Z"));
    expect(await adminResetMarkOf(system, user.userId)).toEqual(new Date("2026-10-28T10:14:00Z"));
    await setAdminResetMark(system, user.userId, null);
    expect(await adminResetMarkOf(system, user.userId)).toBeNull();
  });
});
