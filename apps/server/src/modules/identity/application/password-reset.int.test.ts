// AUTH-04, SEC-02 (КП AUTH): «Забыли пароль?» на Postgres — ответ одинаковый для известного и неизвестного email,
// письмо со ссылкой /recovery?token=… только активному; ссылка одноразовая и живёт 1 час (FakeClock): повтор и
// истёкшая — LINK_INVALID; новый пароль завершает все сессии и подтверждает адрес.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { identityPlatform, seedUser } from "./__fixtures__/identity-platform.ts";
import { makePasswordReset } from "./password-reset.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const local = { listener: "local", host: "127.0.0.1:8140" } as const;
const password = "старый-пароль-2026";

function stack() {
  const env = identityPlatform(db);
  return { ...env, reset: makePasswordReset({ platform: env.platform, mail: env.mail }) };
}

/** Токен из ссылки последнего письма. */
function tokenOf(link: string): string {
  return new URL(link).searchParams.get("token") ?? "";
}

describe("AUTH-04: «Забыли пароль?»", () => {
  it("известный email — письмо со ссылкой на /recovery и сроком 60 мин; неизвестный — тот же ответ без письма", async () => {
    await seedUser(db, { email: "known@example.test", password });
    const { reset, sent, memory } = stack();
    await expect(reset.request("Known@Example.test", local)).resolves.toBeUndefined();
    await expect(reset.request("nobody@example.test", local)).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "known@example.test",
      template: { kind: "reset-password", minutes: 60 },
    });
    expect(sent[0]?.template.link).toMatch(
      /^http:\/\/127\.0\.0\.1:8140\/recovery\?token=[\w-]{43}$/,
    );
    expect(memory.text()).not.toContain("example.test");
  });

  it("заблокированному письмо не уходит, ответ тот же", async () => {
    const { userId } = await seedUser(db, { email: "blocked-reset@example.test", password });
    await db.owner.query("update identity_users set status = 'blocked' where id = $1", [userId]);
    const { reset, sent } = stack();
    await expect(reset.request("blocked-reset@example.test", local)).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });

  it("ссылка задаёт новый пароль: сессии завершены, адрес подтверждён; повтор — LINK_INVALID", async () => {
    const { userId } = await seedUser(db, { email: "once@example.test", password });
    const { reset, sent, auth } = stack();
    const signed = await auth.signIn({ email: "once@example.test", password }, new Headers());
    expect(signed.kind).toBe("ok");
    await reset.request("once@example.test", local);
    const token = tokenOf(sent[0]?.template.link ?? "");

    await reset.reset(token, "новый-пароль-2026");
    const sessions = await db.owner.query("select 1 from identity_sessions where user_id = $1", [
      userId,
    ]);
    expect(sessions.rows).toEqual([]);
    const user = await db.owner.query<{ email_verified: boolean }>(
      "select email_verified from identity_users where id = $1",
      [userId],
    );
    expect(user.rows[0]?.email_verified).toBe(true);
    expect(
      await auth.signIn(
        { email: "once@example.test", password: "новый-пароль-2026" },
        new Headers(),
      ),
    ).toMatchObject({ kind: "ok" });
    expect(await auth.signIn({ email: "once@example.test", password }, new Headers())).toEqual({
      kind: "invalid",
    });

    await expect(reset.reset(token, "третий-пароль-2026")).rejects.toMatchObject({
      code: "LINK_INVALID",
    });
  });

  it("заблокирован после выдачи ссылки — ACCOUNT_BLOCKED, пароль прежний", async () => {
    const { userId } = await seedUser(db, { email: "late-block@example.test", password });
    const { reset, sent, auth } = stack();
    await reset.request("late-block@example.test", local);
    const token = tokenOf(sent[0]?.template.link ?? "");
    await db.owner.query("update identity_users set status = 'blocked' where id = $1", [userId]);
    await expect(reset.reset(token, "новый-пароль-2026")).rejects.toMatchObject({
      code: "ACCOUNT_BLOCKED",
    });
    await db.owner.query("update identity_users set status = 'active' where id = $1", [userId]);
    expect(
      await auth.signIn({ email: "late-block@example.test", password }, new Headers()),
    ).toMatchObject({ kind: "ok" });
  });

  it("ссылка через 61 минуту — LINK_INVALID, пароль прежний", async () => {
    await seedUser(db, { email: "late@example.test", password });
    const { reset, sent, clock, auth } = stack();
    await reset.request("late@example.test", local);
    clock.advance(61 * 60_000);
    await expect(
      reset.reset(tokenOf(sent[0]?.template.link ?? ""), "новый-пароль-2026"),
    ).rejects.toMatchObject({ code: "LINK_INVALID" });
    expect(
      await auth.signIn({ email: "late@example.test", password }, new Headers()),
    ).toMatchObject({
      kind: "ok",
    });
  });

  it("SEC-02: на один email — 3 запроса в час, четвёртый — RATE_LIMITED", async () => {
    const { reset } = stack();
    for (let i = 0; i < 3; i += 1) await reset.request("flood@example.test", local);
    await expect(reset.request("flood@example.test", local)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});
