// Регистрация сквозь HTTP, корень композиции и очередь (AUTH-01…03, AUTH-06, PRIV-01, PRIV-02, SEC-02, STMT-01, NFR-24):
// пользователь с согласиями → письмо в локальном ящике со ссылкой по адресу входа → вход сразу → «Наличные» от
// worker → подтверждение по ссылке один раз; «Отправить ещё раз» и регистрация ограничены по частоте.
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sessionCookie, startHttpStack, type HttpStack } from "./__fixtures__/http-stack.ts";

let db: TestDb;
let stack: HttpStack;
beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db);
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

const consents = (cloud: boolean) => ({
  personalData: { accepted: true, version: CONSENT_VERSIONS.personalData },
  cloud: { accepted: cloud, version: CONSENT_VERSIONS.cloud },
});

const registration = (email: string, cloud = false) => ({
  email,
  password: "надёжный-пароль-12",
  consents: consents(cloud),
});

interface Letter {
  readonly to: string;
  readonly subject: string;
  readonly action: { label: string; url: string } | null;
}

/** Письма ящика на адрес (новые сверху). */
async function lettersTo(email: string): Promise<Letter[]> {
  const box = (await (await stack.call("local", "/mail/mailbox")).json()) as { messages: Letter[] };
  return box.messages.filter((m) => m.to === email);
}

/** Токен из ссылки последнего письма на адрес. */
async function lastToken(email: string): Promise<{ url: URL; token: string }> {
  const [letter] = await lettersTo(email);
  if (letter?.action === null || letter === undefined) throw new Error("нет письма со ссылкой");
  const url = new URL(letter.action.url);
  return { url, token: url.searchParams.get("token") ?? "" };
}

describe("AUTH-01…03, PRIV-01/02: регистрация", () => {
  it("создаёт пользователя с согласиями, сразу входит, письмо со ссылкой — в ящике, «Наличные» — от worker", async () => {
    const response = await stack.call("local", "/identity/register", {
      body: registration("Irina@Example.test", true),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      email: "irina@example.test",
      name: "",
      role: "user",
      emailVerified: false,
    });
    const cookie = sessionCookie(response);

    const { rows } = await db.owner.query<{ kind: string; granted: boolean; text_version: string }>(
      `select c.kind, c.granted, c.text_version from privacy_consents c
       join identity_users u on u.id = c.user_id and u.household_id = c.household_id
       where u.email = 'irina@example.test' order by c.kind`,
    );
    expect(rows).toEqual([
      { kind: "cloud", granted: true, text_version: CONSENT_VERSIONS.cloud },
      { kind: "personal-data", granted: true, text_version: CONSENT_VERSIONS.personalData },
    ]);

    const [letter] = await lettersTo("irina@example.test");
    expect(letter).toMatchObject({
      subject: "Подтвердите адрес электронной почты",
      action: { label: "Подтвердить адрес" },
    });
    const { url, token } = await lastToken("irina@example.test");
    expect(url.origin + url.pathname).toBe("http://127.0.0.1:8140/verify-email");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await vi.waitFor(
      async () => {
        const body = (await (await stack.call("local", "/accounts", { cookie })).json()) as {
          items: { kind: string }[];
        };
        expect(body.items.map((i) => i.kind)).toEqual(["cash"]);
      },
      { timeout: 15_000, interval: 200 },
    );
  }, 30_000);

  it("без согласия на обработку ПД — VALIDATION, пользователя нет", async () => {
    const response = await stack.call("local", "/identity/register", {
      body: {
        ...registration("no-consent@example.test"),
        consents: { ...consents(false), personalData: { accepted: false, version: "2026-10-26" } },
      },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION" });
    const { rows } = await db.owner.query(
      "select 1 from identity_users where email = 'no-consent@example.test'",
    );
    expect(rows).toEqual([]);
  });

  it("email уже занят (в другом регистре) — EMAIL_TAKEN без cookie и без письма", async () => {
    await stack.call("local", "/identity/register", { body: registration("taken@example.test") });
    const again = await stack.call("local", "/identity/register", {
      body: registration("TAKEN@example.test"),
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "EMAIL_TAKEN" });
    expect(again.headers.getSetCookie()).toEqual([]);
    expect(await lettersTo("taken@example.test")).toHaveLength(1);
  });

  it("регистрация через сетевой вход — ссылка в письме по адресу этого входа (NFR-24)", async () => {
    const response = await stack.call("lan", "/identity/register", {
      body: registration("lan@example.test"),
    });
    expect(response.status).toBe(200);
    const { url } = await lastToken("lan@example.test");
    expect(url.origin).toBe("http://192.168.1.5:8141");
  });

  it("SEC-02: на один email — не больше 3 попыток в час, четвёртая — RATE_LIMITED с минутами", async () => {
    for (let i = 0; i < 3; i += 1) {
      await stack.call("local", "/identity/register", { body: registration("spam@example.test") });
    }
    const fourth = await stack.call("local", "/identity/register", {
      body: registration("spam@example.test"),
    });
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toMatchObject({
      code: "RATE_LIMITED",
      data: { params: { retryAfterMinutes: expect.any(Number) } },
    });
  });
});

describe("AUTH-03: подтверждение адреса и «Отправить письмо ещё раз»", () => {
  it("ссылка подтверждает адрес один раз; повтор — LINK_INVALID", async () => {
    const response = await stack.call("local", "/identity/register", {
      body: registration("verify@example.test"),
    });
    const cookie = sessionCookie(response);
    const { token } = await lastToken("verify@example.test");

    const first = await stack.call("local", "/identity/verify-email", { body: { token } });
    expect(first.status).toBe(200);
    const me = await (await stack.call("local", "/identity/me", { cookie })).json();
    expect(me).toMatchObject({ emailVerified: true });

    const again = await stack.call("local", "/identity/verify-email", { body: { token } });
    expect(again.status).toBe(410);
    expect(await again.json()).toMatchObject({ code: "LINK_INVALID" });
  });

  it("«ещё раз» шлёт новое письмо, прежняя ссылка гаснет; подтверждённому — без письма", async () => {
    const cookie = sessionCookie(
      await stack.call("local", "/identity/register", {
        body: registration("resend@example.test"),
      }),
    );
    const { token: old } = await lastToken("resend@example.test");
    expect(
      (await stack.call("local", "/identity/resend-verification", { cookie, post: true })).status,
    ).toBe(200);
    expect(await lettersTo("resend@example.test")).toHaveLength(2);
    const { token: fresh } = await lastToken("resend@example.test");
    expect(
      (await stack.call("local", "/identity/verify-email", { body: { token: old } })).status,
    ).toBe(410);
    expect(
      (await stack.call("local", "/identity/verify-email", { body: { token: fresh } })).status,
    ).toBe(200);
    await stack.call("local", "/identity/resend-verification", { cookie, post: true });
    expect(await lettersTo("resend@example.test")).toHaveLength(2);
  });

  it("SEC-02: «ещё раз» — не больше 3 в час, затем RATE_LIMITED; без входа — UNAUTHORIZED", async () => {
    const cookie = sessionCookie(
      await stack.call("local", "/identity/register", { body: registration("often@example.test") }),
    );
    for (let i = 0; i < 3; i += 1) {
      await stack.call("local", "/identity/resend-verification", { cookie, post: true });
    }
    const fourth = await stack.call("local", "/identity/resend-verification", {
      cookie,
      post: true,
    });
    expect(fourth.status).toBe(429);
    const guest = await stack.call("local", "/identity/resend-verification", { post: true });
    expect(guest.status).toBe(401);
  });
});
