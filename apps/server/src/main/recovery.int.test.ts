// Вход и восстановление доступа сквозь HTTP и корень композиции (AUTH-04, AUTH-05, AUTH-08, AUTH-11, SEC-02): код
// восстановления администратора в ответе первого запуска; «Забыли пароль?» отвечает одинаково на любой email;
// ссылка из ящика задаёт пароль один раз; вход с кодом выдаёт новый код; частота входа на email; заблокированный не
// получает cookie; смена пароля завершает другие сессии.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IdentityFacade } from "../modules/identity/index.ts";
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

const admin = { email: "admin@example.test", password: "пароль-администратора" };

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function identity(): IdentityFacade {
  const module = stack.api.modules.find((m) => m.id === "identity");
  if (module === undefined) throw new Error("нет модуля identity");
  return module.facade as IdentityFacade;
}

async function userId(email: string): Promise<string> {
  const { rows } = await db.owner.query<{ id: string }>(
    "select id from identity_users where email = $1",
    [email],
  );
  return rows[0]?.id ?? "";
}

/** Ссылка последнего письма на адрес. */
async function lastLink(email: string): Promise<URL> {
  const box = (await (await stack.call("local", "/mail/mailbox")).json()) as {
    messages: { to: string; action: { url: string } | null }[];
  };
  const url = box.messages.find((m) => m.to === email)?.action?.url;
  if (url === undefined) throw new Error("нет письма");
  return new URL(url);
}

async function register(email: string, password: string): Promise<Response> {
  return stack.call("local", "/identity/register", {
    body: {
      email,
      password,
      consents: {
        personalData: { accepted: true, version: "2026-10-26" },
        cloud: { accepted: false, version: "2026-10-26" },
      },
    },
  });
}

describe("AUTH-05: код восстановления администратора", () => {
  it("первый запуск отдаёт код один раз; вход с кодом — новый пароль, новый код и cookie; старый код — отказ", async () => {
    const setup = await stack.call("local", "/identity/setup", { body: admin });
    expect(setup.status).toBe(200);
    const { recoveryCode } = (await setup.json()) as { recoveryCode: string };
    expect(recoveryCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);

    const recovered = await stack.call("local", "/identity/recovery-code/sign-in", {
      body: { email: admin.email, code: recoveryCode, password: "новый-пароль-админа" },
    });
    expect(recovered.status).toBe(200);
    const body = (await recovered.json()) as { user: { role: string }; recoveryCode: string };
    expect(body.user.role).toBe("admin");
    expect(body.recoveryCode).not.toBe(recoveryCode);
    const cookie = sessionCookie(recovered);
    expect((await stack.call("local", "/identity/me", { cookie })).status).toBe(200);

    const again = await stack.call("local", "/identity/recovery-code/sign-in", {
      body: { email: admin.email, code: recoveryCode, password: "третий-пароль-админа" },
    });
    expect(again.status).toBe(401);
    expect(await json(again)).toMatchObject({ code: "INVALID_CREDENTIALS" });

    const status = await json(await stack.call("local", "/identity/recovery-code", { cookie }));
    expect(status["createdAt"]).toEqual(expect.any(String));
  });
});

describe("AUTH-04: «Забыли пароль?»", () => {
  it("известный и неизвестный email — один и тот же ответ", async () => {
    await register("forgot@example.test", "старый-пароль-2026");
    const known = await stack.call("local", "/identity/password-reset/request", {
      body: { email: "forgot@example.test" },
    });
    const unknown = await stack.call("local", "/identity/password-reset/request", {
      body: { email: "nobody@example.test" },
    });
    expect([known.status, await known.json()]).toEqual([unknown.status, await unknown.json()]);
    expect(known.status).toBe(200);
  });

  it("ссылка из письма задаёт новый пароль один раз; старый пароль больше не входит", async () => {
    await register("reset@example.test", "старый-пароль-2026");
    await stack.call("local", "/identity/password-reset/request", {
      body: { email: "reset@example.test" },
    });
    const link = await lastLink("reset@example.test");
    expect(link.pathname).toBe("/recovery");
    const token = link.searchParams.get("token");
    const ok = await stack.call("local", "/identity/password-reset", {
      body: { token, password: "новый-пароль-2026" },
    });
    expect(ok.status).toBe(200);
    const reuse = await stack.call("local", "/identity/password-reset", {
      body: { token, password: "третий-пароль-2026" },
    });
    expect(reuse.status).toBe(410);
    expect(await json(reuse)).toMatchObject({ code: "LINK_INVALID" });
    const old = await stack.call("local", "/identity/sign-in", {
      body: { email: "reset@example.test", password: "старый-пароль-2026" },
    });
    expect(old.status).toBe(401);
    const fresh = await stack.call("local", "/identity/sign-in", {
      body: { email: "reset@example.test", password: "новый-пароль-2026" },
    });
    expect(fresh.status).toBe(200);
  });
});

describe("AUTH-08, AUTH-11, SEC-02: вход", () => {
  it("5 попыток на email за 15 минут; шестая — RATE_LIMITED с минутами, даже с верным паролем", async () => {
    await register("brute@example.test", "верный-пароль-2026");
    for (let i = 0; i < 5; i += 1) {
      const wrong = await stack.call("local", "/identity/sign-in", {
        body: { email: "brute@example.test", password: `неверный-${String(i)}` },
      });
      expect(wrong.status).toBe(401);
    }
    const blocked = await stack.call("local", "/identity/sign-in", {
      body: { email: "Brute@Example.test", password: "верный-пароль-2026" },
    });
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as {
      code: string;
      data: { params: { retryAfterMinutes: number } };
    };
    expect(body.code).toBe("RATE_LIMITED");
    // Окно фиксированное (15 минут по часам): до его конца — от 1 до 15 минут.
    expect(body.data.params.retryAfterMinutes).toBeGreaterThanOrEqual(1);
    expect(body.data.params.retryAfterMinutes).toBeLessThanOrEqual(15);
  });

  it("заблокированный: прежняя cookie больше не работает, вход — ACCOUNT_BLOCKED без cookie", async () => {
    const cookie = sessionCookie(await register("blocked@example.test", "верный-пароль-2026"));
    expect((await stack.call("local", "/identity/me", { cookie })).status).toBe(200);
    await identity().setStatus(await userId("blocked@example.test"), "blocked");
    expect((await stack.call("local", "/identity/me", { cookie })).status).toBe(401);
    const signIn = await stack.call("local", "/identity/sign-in", {
      body: { email: "blocked@example.test", password: "верный-пароль-2026" },
    });
    expect(signIn.status).toBe(403);
    expect(await json(signIn)).toMatchObject({ code: "ACCOUNT_BLOCKED" });
    expect(signIn.headers.getSetCookie()).toEqual([]);
  });

  it("смена пароля: неверный текущий — INVALID_CREDENTIALS; верный — новая cookie, другая сессия завершена", async () => {
    const first = sessionCookie(await register("change@example.test", "верный-пароль-2026"));
    const second = sessionCookie(
      await stack.call("local", "/identity/sign-in", {
        body: { email: "change@example.test", password: "верный-пароль-2026" },
      }),
    );
    const wrong = await stack.call("local", "/identity/password", {
      cookie: first,
      body: { currentPassword: "не-тот-пароль", newPassword: "новый-пароль-2026" },
    });
    expect(await json(wrong)).toMatchObject({ code: "INVALID_CREDENTIALS" });
    const changed = await stack.call("local", "/identity/password", {
      cookie: first,
      body: { currentPassword: "верный-пароль-2026", newPassword: "новый-пароль-2026" },
    });
    expect(changed.status).toBe(200);
    const renewed = sessionCookie(changed);
    expect((await stack.call("local", "/identity/me", { cookie: renewed })).status).toBe(200);
    expect((await stack.call("local", "/identity/me", { cookie: second })).status).toBe(401);
  });
});
