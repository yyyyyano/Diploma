// AUTH-11, AUTH-12: блокировка сразу завершает сессии; последнего администратора нельзя заблокировать, лишить роли
// и удалить; два администратора одновременно снимают роль друг с друга — один остаётся (блокировка строк).
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { identityPlatform, seedUser } from "./__fixtures__/identity-platform.ts";
import { makeAdminGuard } from "./admins.ts";

let db: TestDb | undefined;
afterAll(async () => {
  await db?.drop();
});
/** Своя база на тест: «последний администратор» считается по всей таблице пользователей. */
beforeEach(async () => {
  await db?.drop();
  db = await createTestDb();
});

function testDb(): TestDb {
  if (db === undefined) throw new Error("нет базы");
  return db;
}

const password = "пароль-админа-2026";

async function role(userId: string) {
  const { rows } = await testDb().owner.query<{ role: string; status: string }>(
    "select role, status from identity_users where id = $1",
    [userId],
  );
  return rows[0];
}

describe("AUTH-11: блокировка", () => {
  it("блокировка сразу завершает действующие сессии: cookie больше не открывает сессию; разблокировка — вход снова", async () => {
    const env = identityPlatform(testDb());
    await seedUser(testDb(), { email: "admin@example.test", password, role: "admin" });
    const { userId } = await seedUser(testDb(), { email: "user@example.test", password });
    const signed = await env.auth.signIn({ email: "user@example.test", password }, new Headers());
    if (signed.kind !== "ok") throw new Error("вход не прошёл");
    const cookie = new Headers({ cookie: signed.cookies[0]?.split(";")[0] ?? "" });
    expect(await env.auth.session(cookie)).toBeDefined();

    const guard = makeAdminGuard(env.platform);
    await guard.setStatus(userId, "blocked");
    expect(await env.auth.session(cookie)).toBeUndefined();
    const { rows } = await testDb().owner.query(
      "select 1 from identity_sessions where user_id = $1",
      [userId],
    );
    expect(rows).toEqual([]);
    expect(await env.auth.signIn({ email: "user@example.test", password }, new Headers())).toEqual({
      kind: "blocked",
    });

    await guard.setStatus(userId, "active");
    expect(
      await env.auth.signIn({ email: "user@example.test", password }, new Headers()),
    ).toMatchObject({
      kind: "ok",
    });
  });

  it("неизвестный пользователь — NOT_FOUND", async () => {
    const guard = makeAdminGuard(identityPlatform(testDb()).platform);
    await expect(
      guard.setStatus("0199f0a0-0000-7000-8000-0000000000aa", "blocked"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("AUTH-12: последний администратор", () => {
  it("единственного администратора нельзя заблокировать, лишить роли и удалить", async () => {
    const { userId } = await seedUser(testDb(), {
      email: "only@example.test",
      password,
      role: "admin",
    });
    const guard = makeAdminGuard(identityPlatform(testDb()).platform);
    await expect(guard.setStatus(userId, "blocked")).rejects.toMatchObject({ code: "LAST_ADMIN" });
    await expect(guard.setRole(userId, "user")).rejects.toMatchObject({ code: "LAST_ADMIN" });
    const system = createSystemDb(testDb().pool);
    await expect(
      system.transaction((tx) => guard.assertRemovable(tx, userId)),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });
    expect(await role(userId)).toEqual({ role: "admin", status: "active" });
  });

  it("при втором администраторе первого можно лишить роли; назначенный становится последним", async () => {
    const first = await seedUser(testDb(), {
      email: "first@example.test",
      password,
      role: "admin",
    });
    const second = await seedUser(testDb(), { email: "second@example.test", password });
    const guard = makeAdminGuard(identityPlatform(testDb()).platform);
    await guard.setRole(second.userId, "admin");
    await guard.setRole(first.userId, "user");
    expect(await role(first.userId)).toEqual({ role: "user", status: "active" });
    await expect(guard.setRole(second.userId, "user")).rejects.toMatchObject({
      code: "LAST_ADMIN",
    });
  });

  it("заблокированный администратор не считается: последнего активного нельзя заблокировать", async () => {
    const a = await seedUser(testDb(), { email: "a@example.test", password, role: "admin" });
    const b = await seedUser(testDb(), { email: "b@example.test", password, role: "admin" });
    const guard = makeAdminGuard(identityPlatform(testDb()).platform);
    await guard.setStatus(a.userId, "blocked");
    await expect(guard.setStatus(b.userId, "blocked")).rejects.toMatchObject({
      code: "LAST_ADMIN",
    });
  });

  it("два администратора одновременно снимают роль друг с друга — ровно одна смена проходит, админ остаётся", async () => {
    const a = await seedUser(testDb(), { email: "a@example.test", password, role: "admin" });
    const b = await seedUser(testDb(), { email: "b@example.test", password, role: "admin" });
    const guardA = makeAdminGuard(identityPlatform(testDb()).platform);
    const guardB = makeAdminGuard(identityPlatform(testDb()).platform);
    const results = await Promise.allSettled([
      guardA.setRole(b.userId, "user"),
      guardB.setRole(a.userId, "user"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "LAST_ADMIN" },
    });
    const { rows } = await testDb().owner.query(
      "select 1 from identity_users where role = 'admin' and status = 'active'",
    );
    expect(rows).toHaveLength(1);
  });
});
