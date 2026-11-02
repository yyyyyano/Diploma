// DEMO-04, AUTH-11: встроенный демо-пользователь — запись identity с отметкой demo, согласие на облако выдано, вход без пароля
// человека (пароль выводится из мастер-ключа и никому не показывается), второй вызов — тот же пользователь; админ его не удаляет.
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../../../platform/errors/app-error.ts";
import { identityPlatform, seedUser } from "./__fixtures__/identity-platform.ts";
import { DEMO_EMAIL, makeDemoUser } from "./demo-user.ts";
import { makeAdminUsers } from "./admin-users.ts";
import { makeTargetUserScope } from "./target-user-scope.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

function setup() {
  const p = identityPlatform(db);
  const published: { name: string; ids: unknown }[] = [];
  const consents: unknown[] = [];
  const platform = {
    ...p.platform,
    deriveKey: () => Buffer.alloc(32, 7),
    events: {
      publish: async (_tx: unknown, event: { name: string }, payload: { ids: unknown }) => {
        published.push({ name: event.name, ids: payload.ids });
      },
    },
  };
  const demo = makeDemoUser({
    platform: platform as never,
    auth: p.auth,
    privacy: {
      recordRegistrationConsents: async (_tx: unknown, value: unknown) => {
        consents.push(value);
      },
    } as never,
  });
  return { p, platform, demo, published, consents };
}

describe("DEMO-04: демо-пользователь", () => {
  it("создаётся один раз: отметка demo, роль user, событие регистрации, согласия на ПД и облако выданы", async () => {
    const { demo, published, consents } = setup();
    const first = await demo.ensure();
    expect(first.created).toBe(true);
    const row = (
      await db.owner.query(
        "select email, role, status, demo, household_id from identity_users where id = $1",
        [first.scope.userId],
      )
    ).rows[0];
    expect(row).toMatchObject({
      email: DEMO_EMAIL,
      role: "user",
      status: "active",
      demo: true,
      household_id: first.scope.householdId,
    });
    expect(published).toEqual([{ name: "identity.user-registered", ids: [first.scope.userId] }]);
    expect(consents).toEqual([
      {
        personalData: { accepted: true, version: CONSENT_VERSIONS.personalData },
        cloud: { accepted: true, version: CONSENT_VERSIONS.cloud },
      },
    ]);

    const second = await demo.ensure();
    expect(second.created).toBe(false);
    expect(second.scope).toEqual(first.scope);
    expect(published).toHaveLength(1);
  });

  it("два одновременных вызова дают одного пользователя", async () => {
    const dbRace = await createTestDb();
    try {
      const p = identityPlatform(dbRace);
      const demo = makeDemoUser({
        platform: {
          ...p.platform,
          deriveKey: () => Buffer.alloc(32, 7),
          events: { publish: async () => {} },
        } as never,
        auth: p.auth,
        privacy: { recordRegistrationConsents: async () => {} } as never,
      });
      const [a, b] = await Promise.all([demo.ensure(), demo.ensure()]);
      expect(a.scope.userId).toBe(b.scope.userId);
      const count = await dbRace.owner.query("select count(*)::int as n from identity_users");
      expect(count.rows[0]).toEqual({ n: 1 });
    } finally {
      await dbRace.drop();
    }
  });

  it("вход без пароля человека: сессия есть, карточка — демо; чужой пароль не подходит", async () => {
    const { p, demo } = setup();
    await demo.ensure();
    const signed = await demo.signIn(new Headers());
    expect(signed.cookies.some((cookie) => cookie.startsWith("kosht_session="))).toBe(true);
    expect(signed.user).toMatchObject({ email: DEMO_EMAIL, role: "user" });
    expect(
      await p.auth.signIn({ email: DEMO_EMAIL, password: "пароль-угадан-2026" }, new Headers()),
    ).toEqual({
      kind: "invalid",
    });
  });

  it("демо-пользователя ещё нет — signIn отвечает NOT_FOUND, сессия не выдаётся", async () => {
    const dbEmpty = await createTestDb();
    try {
      const p = identityPlatform(dbEmpty);
      const demo = makeDemoUser({
        platform: { ...p.platform, deriveKey: () => Buffer.alloc(32, 7), events: {} } as never,
        auth: p.auth,
        privacy: {} as never,
      });
      await expect(demo.signIn(new Headers())).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await dbEmpty.drop();
    }
  });

  it("администратор не удаляет демо-пользователя: CONFLICT, учётная запись на месте", async () => {
    const { p, platform, demo } = setup();
    const admin = await seedUser(db, {
      email: "admin-demo@example.test",
      password: "пароль-админа-2026",
      role: "admin",
    });
    await demo.ensure();
    const target = (
      await db.owner.query("select id from identity_users where email = $1", [DEMO_EMAIL])
    ).rows[0] as { id: string };
    const users = makeAdminUsers({
      platform: p.platform,
      mail: p.mail,
      passwordReset: {} as never,
      eraseUser: (async () => {
        throw new Error("демо не должно дойти до удаления");
      }) as never,
      targetUserScope: makeTargetUserScope(platform),
    });
    const actor = { userId: admin.userId, householdId: admin.householdId } as never;
    await expect(users.remove(actor, target.id, DEMO_EMAIL)).rejects.toSatisfy(
      (error) => error instanceof AppError && error.code === "CONFLICT",
    );
  });
});
