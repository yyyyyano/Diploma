// Спайк T-009 (ADR-0016): ядро Better Auth на SystemDb (адаптер Drizzle 1.0 RC, аудитор SQL, без $client) с нашими
// таблицами, паролем argon2id и cookie kosht_session — вход, сессия по cookie, выход.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb, type SystemDb } from "../../../platform/db/system-db.ts";
import { createAuth, SESSION_COOKIE, type Auth } from "./auth.ts";
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
