// ADM-30, ADM-60, AUTH-05, AUTH-12, R37, PRIV-07 сквозь HTTP и корень композиции: раздел «Администрирование» — только
// роль admin (обычному — FORBIDDEN); «Пользователи» — учётные записи с режимом ИИ, без данных домохозяйств;
// блокировка завершает сессии, последний администратор защищён; удаление — только с верным email, данные удалённого
// стёрты, другой не задет; сброс пароля — письмом самому пользователю или, без подтверждённой почты, ссылкой
// администратору с отметкой, которую пользователь видит и гасит; «Система» — пояс, сеть, почта и тестовое письмо.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProductionSchemas } from "../platform/db/__fixtures__/production-schemas.ts";
import { registeredTables } from "../platform/db/tables.ts";
import {
  registerUser,
  sessionCookie,
  STACK_PASSWORD,
  startHttpStack,
  type HttpStack,
} from "./__fixtures__/http-stack.ts";

let db: TestDb;
let stack: HttpStack;
let root: string;
let rootId: string;
beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db, { worker: false });
  await loadProductionSchemas();
  const admin = { email: "root@example.test", password: STACK_PASSWORD };
  const setup = await stack.call("local", "/identity/setup", { body: admin });
  if (setup.status !== 200) throw new Error(`первый запуск не прошёл: ${String(setup.status)}`);
  root = sessionCookie(await stack.call("local", "/identity/sign-in", { body: admin }));
  rootId = await idOf("root@example.test");
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

async function idOf(email: string): Promise<string> {
  const { rows } = await db.owner.query<{ id: string }>(
    "select id from identity_users where email = $1",
    [email],
  );
  return rows[0]?.id ?? "";
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface UserRow {
  id: string;
  email: string;
  role: string;
  status: string;
  cloud: boolean;
  self: boolean;
  emailVerified: boolean;
}

async function users(cookie = root): Promise<UserRow[]> {
  return (await json<{ items: UserRow[] }>(await stack.call("local", "/admin/users", { cookie })))
    .items;
}

describe("ADM-30, PRIV-07: доступ и список", () => {
  it("обычный пользователь — FORBIDDEN на каждой процедуре админки", async () => {
    const user = await registerUser(stack, db, "plain@example.test");
    for (const [path, body] of [
      ["/admin/users", undefined],
      ["/admin/system", undefined],
      ["/admin/users/status", { id: rootId, status: "blocked" }],
      ["/admin/users/delete", { id: rootId, email: "root@example.test" }],
      ["/admin/system/time-zone", { timeZone: "Asia/Tokyo" }],
    ] as const) {
      const response = await stack.call("local", path, { cookie: user.cookie, body });
      expect([path, response.status]).toEqual([path, 403]);
    }
    expect((await stack.call("local", "/admin/users")).status).toBe(401);
  });

  it("список — учётные записи с режимом ИИ и отметкой «вы», без данных домохозяйств", async () => {
    await registerUser(stack, db, "cloudy@example.test", { cloud: true });
    const list = await users();
    expect(list.find((u) => u.email === "root@example.test")).toMatchObject({
      role: "admin",
      status: "active",
      self: true,
    });
    expect(list.find((u) => u.email === "cloudy@example.test")).toMatchObject({
      role: "user",
      cloud: true,
      self: false,
      emailVerified: false,
    });
    expect(Object.keys(list[0] ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "cloud",
      "demo",
      "email",
      "emailVerified",
      "id",
      "registeredAt",
      "role",
      "self",
      "status",
      "telegram",
    ]);
  });
});

describe("AUTH-11, AUTH-12: блокировка и роль", () => {
  it("блокировка завершает сессии пользователя; разблокировка; последнего администратора — LAST_ADMIN", async () => {
    const user = await registerUser(stack, db, "blocked@example.test");
    const blocked = await stack.call("local", "/admin/users/status", {
      cookie: root,
      body: { id: user.userId, status: "blocked" },
    });
    expect(blocked.status).toBe(200);
    expect((await stack.call("local", "/identity/me", { cookie: user.cookie })).status).toBe(401);
    expect(
      (
        await stack.call("local", "/admin/users/status", {
          cookie: root,
          body: { id: user.userId, status: "active" },
        })
      ).status,
    ).toBe(200);
    const self = await stack.call("local", "/admin/users/status", {
      cookie: root,
      body: { id: rootId, status: "blocked" },
    });
    expect(self.status).toBe(409);
    expect(await self.json()).toMatchObject({ code: "LAST_ADMIN" });
    const demote = await stack.call("local", "/admin/users/role", {
      cookie: root,
      body: { id: rootId, role: "user" },
    });
    expect(await demote.json()).toMatchObject({ code: "LAST_ADMIN" });
  });

  it("назначенный администратор видит раздел; снятая роль — снова FORBIDDEN", async () => {
    const user = await registerUser(stack, db, "second-admin@example.test");
    await stack.call("local", "/admin/users/role", {
      cookie: root,
      body: { id: user.userId, role: "admin" },
    });
    expect((await stack.call("local", "/admin/users", { cookie: user.cookie })).status).toBe(200);
    await stack.call("local", "/admin/users/role", {
      cookie: root,
      body: { id: user.userId, role: "user" },
    });
    expect((await stack.call("local", "/admin/users", { cookie: user.cookie })).status).toBe(403);
  });
});

describe("ADM-30, PRIV-06: удаление пользователя администратором", () => {
  async function rowsByTable(householdId: string): Promise<number> {
    let total = 0;
    for (const [table, kind] of registeredTables()) {
      if (kind !== "user") continue;
      const { rows } = await db.owner.query<{ n: number }>(
        `select count(*)::int as n from "${table}" where household_id = $1`,
        [householdId],
      );
      total += rows[0]?.n ?? 0;
    }
    return total;
  }

  it("неверный email — VALIDATION, ничего не удалено; верный — пользователь и его данные стёрты, другой не задет", async () => {
    const target = await registerUser(stack, db, "target@example.test");
    const other = await registerUser(stack, db, "bystander@example.test");
    expect(await rowsByTable(target.householdId)).toBeGreaterThan(0);
    const otherBefore = await rowsByTable(other.householdId);

    const wrong = await stack.call("local", "/admin/users/delete", {
      cookie: root,
      body: { id: target.userId, email: "bystander@example.test" },
    });
    expect(wrong.status).toBe(400);
    expect((await stack.call("local", "/identity/me", { cookie: target.cookie })).status).toBe(200);

    const removed = await stack.call("local", "/admin/users/delete", {
      cookie: root,
      body: { id: target.userId, email: " Target@Example.test " },
    });
    expect(removed.status).toBe(200);
    expect(await idOf("target@example.test")).toBe("");
    expect(await rowsByTable(target.householdId)).toBe(0);
    expect((await stack.call("local", "/identity/me", { cookie: target.cookie })).status).toBe(401);
    expect(await rowsByTable(other.householdId)).toBe(otherBefore);
    expect((await stack.call("local", "/identity/me", { cookie: other.cookie })).status).toBe(200);
  });

  it("единственного администратора удалить нельзя — LAST_ADMIN", async () => {
    const response = await stack.call("local", "/admin/users/delete", {
      cookie: root,
      body: { id: rootId, email: "root@example.test" },
    });
    expect(response.status).toBe(409);
    expect(await idOf("root@example.test")).toBe(rootId);
  });
});

describe("AUTH-05, R37: сброс пароля из админки", () => {
  async function mailboxTo(email: string) {
    const box = await json<{ messages: { to: string; action: { url: string } | null }[] }>(
      await stack.call("local", "/mail/mailbox"),
    );
    return box.messages.filter((m) => m.to === email);
  }

  it("почта подтверждена — ссылка уходит письмом пользователю, администратору не показывается", async () => {
    const user = await registerUser(stack, db, "verified@example.test");
    await db.owner.query("update identity_users set email_verified = true where id = $1", [
      user.userId,
    ]);
    const before = (await mailboxTo("verified@example.test")).length;
    const response = await stack.call("local", "/admin/users/reset-password", {
      cookie: root,
      body: { id: user.userId },
    });
    expect(await response.json()).toEqual({ delivery: "email" });
    const letters = await mailboxTo("verified@example.test");
    expect(letters).toHaveLength(before + 1);
    expect(letters[0]?.action?.url).toMatch(/\/recovery\?token=/);
  });

  it("NFR-24: сброс через сетевой вход с чужим Host — ссылка в письме не по Host, а по адресу из настроек", async () => {
    const user = await registerUser(stack, db, "spoofed-host@example.test");
    await db.owner.query("update identity_users set email_verified = true where id = $1", [
      user.userId,
    ]);
    const response = await stack.call("lan", "/admin/users/reset-password", {
      cookie: root,
      body: { id: user.userId },
      host: "10.6.6.6:80",
    });
    expect(await response.json()).toEqual({ delivery: "email" });
    const url = new URL((await mailboxTo("spoofed-host@example.test"))[0]?.action?.url ?? "");
    expect(url.origin).toBe("http://127.0.0.1:8140");
  });

  it("почты нет — ссылка показана администратору; пользователь видит отметку, гасит её, ссылка работает", async () => {
    const user = await registerUser(stack, db, "unverified@example.test");
    const response = await stack.call("local", "/admin/users/reset-password", {
      cookie: root,
      body: { id: user.userId },
    });
    const result = await json<{ delivery: string; link: string }>(response);
    expect(result.delivery).toBe("shown");
    const notice = await json<{ at: string | null }>(
      await stack.call("local", "/identity/admin-reset", { cookie: user.cookie }),
    );
    expect(notice.at).toEqual(expect.any(String));

    const token = new URL(result.link).searchParams.get("token");
    const reset = await stack.call("local", "/identity/password-reset", {
      body: { token, password: "новый-пароль-после-сброса" },
    });
    expect(reset.status).toBe(200);
    const signedIn = sessionCookie(
      await stack.call("local", "/identity/sign-in", {
        body: { email: "unverified@example.test", password: "новый-пароль-после-сброса" },
      }),
    );
    expect(
      await json(await stack.call("local", "/identity/admin-reset", { cookie: signedIn })),
    ).toEqual({ at: notice.at });
    await stack.call("local", "/identity/admin-reset/ack", { cookie: signedIn, post: true });
    expect(
      await json(await stack.call("local", "/identity/admin-reset", { cookie: signedIn })),
    ).toEqual({ at: null });
  });
});

describe("ADM-60: «Система»", () => {
  it("пояс, доступ из сети, почта и тестовое письмо — на адрес администратора в локальный ящик", async () => {
    const overview = await json<{ timeZone: string; mail: { configured: boolean } }>(
      await stack.call("local", "/admin/system", { cookie: root }),
    );
    expect(overview).toMatchObject({ timeZone: "Europe/Minsk", mail: { configured: false } });

    const zone = await stack.call("local", "/admin/system/time-zone", {
      cookie: root,
      body: { timeZone: "Asia/Tokyo" },
    });
    expect(await zone.json()).toMatchObject({ timeZone: "Asia/Tokyo" });
    const badZone = await stack.call("local", "/admin/system/time-zone", {
      cookie: root,
      body: { timeZone: "Mars/Olympus" },
    });
    expect(badZone.status).toBe(400);

    const lan = await stack.call("local", "/admin/system/lan", {
      cookie: root,
      body: { allowed: true, address: "http://192.168.1.5:8141" },
    });
    expect(await lan.json()).toMatchObject({
      lan: { allowed: true, address: "http://192.168.1.5:8141" },
    });
    await stack.call("local", "/admin/system/lan", {
      cookie: root,
      body: { allowed: false, address: "" },
    });

    const mail = await stack.call("local", "/admin/system/mail", {
      cookie: root,
      body: { host: "", port: 587, secure: false, user: "", from: "no-reply@kosht.local" },
    });
    expect(await mail.json()).toMatchObject({ mail: { configured: false, passwordSet: false } });
    const test = await stack.call("local", "/admin/system/mail/test", { cookie: root, post: true });
    expect(test.status).toBe(200);
    const box = await json<{ messages: { to: string; subject: string }[] }>(
      await stack.call("local", "/mail/mailbox"),
    );
    expect(box.messages.find((m) => m.to === "root@example.test")?.subject).toBe(
      "Тестовое письмо Кошта",
    );
  });
});
