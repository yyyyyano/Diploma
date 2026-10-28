// AUTH-05, SEC-01, SEC-02: код восстановления на Postgres — в базе только хэш argon2id; «Войти с кодом» задаёт новый
// пароль, выдаёт новый код (старый больше не работает) и входит; неверный код и неизвестный email — одинаковый
// INVALID_CREDENTIALS; заблокированный с верным кодом — ACCOUNT_BLOCKED; частота — на email.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { identityPlatform, seedUser } from "./__fixtures__/identity-platform.ts";
import { makeRecoveryCodes } from "./recovery-code.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const password = "старый-пароль-2026";

function stack() {
  const env = identityPlatform(db);
  return { ...env, codes: makeRecoveryCodes({ platform: env.platform, auth: env.auth }) };
}

describe("AUTH-05: код восстановления", () => {
  it("выдаётся в виде XXXX-XXXX-XXXX-XXXX, в базе — только хэш argon2id", async () => {
    const { userId } = await seedUser(db, { email: "hash@example.test", password });
    const { codes, platform } = stack();
    const { code } = await codes.issue(platform.system, userId);
    expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    const { rows } = await db.owner.query<{ code_hash: string }>(
      "select code_hash from identity_recovery_codes where user_id = $1",
      [userId],
    );
    expect(rows[0]?.code_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0]?.code_hash).not.toContain(code.replaceAll("-", ""));
  });

  it("верный код (как ни введён) — новый пароль, новый код, вход; старый код и старый пароль больше не работают", async () => {
    const { userId } = await seedUser(db, { email: "recover@example.test", password });
    const { codes, platform, auth } = stack();
    const old = await codes.issue(platform.system, userId);
    const signed = await auth.signIn({ email: "recover@example.test", password }, new Headers());
    expect(signed.kind).toBe("ok");

    const result = await codes.recover(
      {
        email: "Recover@Example.test",
        code: ` ${old.code.toLowerCase().replaceAll("-", " ")} `,
        password: "новый-пароль-2026",
      },
      new Headers(),
    );
    expect(result.user).toMatchObject({ email: "recover@example.test" });
    expect(result.recoveryCode).not.toBe(old.code);
    expect(result.cookies.some((c) => c.startsWith("kosht_session="))).toBe(true);
    // Сессия, открытая до восстановления, завершена; осталась только новая.
    const { rows } = await db.owner.query("select 1 from identity_sessions where user_id = $1", [
      userId,
    ]);
    expect(rows).toHaveLength(1);

    await expect(
      codes.recover(
        { email: "recover@example.test", code: old.code, password: "ещё-пароль-2026" },
        new Headers(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(await auth.signIn({ email: "recover@example.test", password }, new Headers())).toEqual({
      kind: "invalid",
    });
  });

  it("неверный код, неизвестный email, пользователь без кода — одинаково INVALID_CREDENTIALS", async () => {
    const { userId } = await seedUser(db, { email: "wrong@example.test", password });
    await seedUser(db, { email: "nocode@example.test", password });
    const { codes, platform } = stack();
    await codes.issue(platform.system, userId);
    for (const email of ["wrong@example.test", "nobody@example.test", "nocode@example.test"]) {
      await expect(
        codes.recover(
          { email, code: "0000-0000-0000-0000", password: "новый-пароль-2026" },
          new Headers(),
        ),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
  });

  it("заблокированный с верным кодом — ACCOUNT_BLOCKED, пароль не меняется", async () => {
    const { userId } = await seedUser(db, { email: "blocked-code@example.test", password });
    const { codes, platform } = stack();
    const { code } = await codes.issue(platform.system, userId);
    await db.owner.query("update identity_users set status = 'blocked' where id = $1", [userId]);
    await expect(
      codes.recover(
        { email: "blocked-code@example.test", code, password: "новый-пароль-2026" },
        new Headers(),
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_BLOCKED" });
  });

  it("два запроса разом с одним верным кодом — проходит один, второй INVALID_CREDENTIALS (код гасится атомарно)", async () => {
    const { userId } = await seedUser(db, { email: "race-code@example.test", password });
    const { codes, platform } = stack();
    const { code } = await codes.issue(platform.system, userId);
    const attempt = (next: string) =>
      codes.recover({ email: "race-code@example.test", code, password: next }, new Headers()).then(
        () => "ok",
        (error: unknown) => (error as { code?: string }).code,
      );
    const results = await Promise.all([
      attempt("первый-пароль-2026"),
      attempt("второй-пароль-2026"),
    ]);
    expect(results).toHaveLength(2);
    expect(results).toEqual(expect.arrayContaining(["ok", "INVALID_CREDENTIALS"]));
  });

  it("SEC-02: 5 попыток на email за 15 минут, шестая — RATE_LIMITED", async () => {
    const { codes } = stack();
    for (let i = 0; i < 5; i += 1) {
      await expect(
        codes.recover(
          {
            email: "brute@example.test",
            code: "0000-0000-0000-0000",
            password: "новый-пароль-2026",
          },
          new Headers(),
        ),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(
      codes.recover(
        { email: "brute@example.test", code: "0000-0000-0000-0000", password: "новый-пароль-2026" },
        new Headers(),
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
