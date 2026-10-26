// Спайк T-009 (ADR-0016): ядро Better Auth на SystemDb (адаптер Drizzle 1.0 RC, аудитор SQL, без $client) с нашими
// таблицами, паролем argon2id и cookie kosht_session — вход, сессия по cookie, выход.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb, type SystemDb } from "../../../platform/db/system-db.ts";
import { createAuth, createAuthGateway, SESSION_COOKIE, type Auth } from "./auth.ts";
import { insertUser, newUserIds } from "./db/identity.repo.ts";
import { hashPassword } from "./password.ts";

let db: TestDb;
let system: SystemDb;
let auth: Auth;
const email = "admin@example.test";
const password = "длинный-пароль-1";

beforeAll(async () => {
  db = await createTestDb();
  system = createSystemDb(db.pool);
  auth = createAuth({ system, secret: "x".repeat(32), baseURL: "http://127.0.0.1:8140" });
  const ids = await newUserIds(system);
  await insertUser(system, {
    ...ids,
    email,
    role: "admin",
    passwordHash: await hashPassword(password),
  });
});

afterAll(async () => {
  await db.drop();
});

/** cookie из Set-Cookie ответа входа: «kosht_session=…». */
function sessionCookie(headers: Headers): string {
  const cookie = headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (cookie === undefined) throw new Error("нет cookie сессии");
  return cookie;
}

describe("AUTH-08: вход и сессия на ядре Better Auth", () => {
  it("вход ставит cookie kosht_session с HttpOnly и SameSite=Lax; по ней видна сессия с домохозяйством", async () => {
    const { headers } = await auth.api.signInEmail({
      body: { email, password },
      headers: new Headers(),
      returnHeaders: true,
    });
    const cookie = sessionCookie(headers);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie.split(";")[0] ?? "" }),
    });
    expect(session?.user).toMatchObject({ email, role: "admin", status: "active" });
    expect(session?.session.householdId).toBe(session?.user.householdId);
  });

  it("неверный пароль — отказ без сессии", async () => {
    const error: unknown = await auth.api
      .signInEmail({ body: { email, password: "неверный-пароль-1" }, headers: new Headers() })
      .catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ statusCode: 401 });
  });

  it("выход завершает сессию: та же cookie больше не открывает её", async () => {
    const { headers } = await auth.api.signInEmail({
      body: { email, password },
      headers: new Headers(),
      returnHeaders: true,
    });
    const cookie = new Headers({ cookie: sessionCookie(headers).split(";")[0] ?? "" });
    const out = await auth.api.signOut({ headers: cookie, returnHeaders: true });
    expect(out.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
    expect(await auth.api.getSession({ headers: cookie })).toBeNull();
  });
});

describe("AUTH-11, AUTH-08: шлюз входа — блокировка, продление cookie, смена пароля", () => {
  async function user(mail: string, status: "active" | "blocked" = "active") {
    const ids = await newUserIds(system);
    await insertUser(system, {
      ...ids,
      email: mail,
      role: "user",
      passwordHash: await hashPassword(password),
    });
    if (status === "blocked") {
      await db.owner.query("update identity_users set status = 'blocked' where id = $1", [
        ids.userId,
      ]);
    }
    return ids;
  }

  it("заблокированный с верным паролем — blocked: ни cookie, ни строки сессии; с неверным — просто invalid", async () => {
    const gateway = createAuthGateway(auth);
    const { userId } = await user("blocked@example.test", "blocked");
    expect(
      await gateway.signIn({ email: "blocked@example.test", password }, new Headers()),
    ).toEqual({ kind: "blocked" });
    expect(
      await gateway.signIn(
        { email: "blocked@example.test", password: "неверный-пароль-1" },
        new Headers(),
      ),
    ).toEqual({ kind: "invalid" });
    const { rows } = await db.owner.query("select 1 from identity_sessions where user_id = $1", [
      userId,
    ]);
    expect(rows).toEqual([]);
  });

  it("сессия, продлённая в БД (раз в сутки), отдаёт новую cookie kosht_session", async () => {
    const gateway = createAuthGateway(auth);
    const { userId } = await user("refresh@example.test");
    const signed = await gateway.signIn({ email: "refresh@example.test", password }, new Headers());
    if (signed.kind !== "ok") throw new Error("вход не прошёл");
    const cookie = new Headers({ cookie: signed.cookies[0]?.split(";")[0] ?? "" });
    expect((await gateway.session(cookie))?.cookies).toEqual([]);
    // Сессии 2 дня: до конца 7-дневного срока осталось 5 дней — пора продлевать (updateAge — сутки).
    await db.owner.query(
      "update identity_sessions set expires_at = now() + interval '5 days' where user_id = $1",
      [userId],
    );
    const refreshed = await gateway.session(cookie);
    expect(refreshed?.cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
    expect(refreshed?.cookies[0]).toMatch(/Max-Age=604800/);
  });

  it("смена пароля: неверный текущий — undefined; верный — новая cookie, прочие сессии завершены", async () => {
    const gateway = createAuthGateway(auth);
    const { userId } = await user("change@example.test");
    const first = await gateway.signIn({ email: "change@example.test", password }, new Headers());
    const second = await gateway.signIn({ email: "change@example.test", password }, new Headers());
    if (first.kind !== "ok" || second.kind !== "ok") throw new Error("вход не прошёл");
    const current = new Headers({ cookie: first.cookies[0]?.split(";")[0] ?? "" });
    const other = new Headers({ cookie: second.cookies[0]?.split(";")[0] ?? "" });
    expect(
      await gateway.changePassword(
        { currentPassword: "не-тот-пароль-1", newPassword: "новый-пароль-2026" },
        current,
      ),
    ).toBeUndefined();
    const cookies = await gateway.changePassword(
      { currentPassword: password, newPassword: "новый-пароль-2026" },
      current,
    );
    expect(cookies?.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
    expect(await gateway.session(other)).toBeUndefined();
    const { rows } = await db.owner.query("select 1 from identity_sessions where user_id = $1", [
      userId,
    ]);
    expect(rows).toHaveLength(1);
    expect(
      await gateway.signIn(
        { email: "change@example.test", password: "новый-пароль-2026" },
        new Headers(),
      ),
    ).toMatchObject({ kind: "ok" });
  });
});
