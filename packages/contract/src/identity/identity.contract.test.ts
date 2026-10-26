// AUTH-10, SEC-01: вход первого запуска и формы входа — пароль администратора не короче 12 символов, владельца во
// входе нет, лишние поля не проходят.
import { describe, expect, it } from "vitest";
import { RegisterInput, SetupInput, SignInInput, VerifyEmailInput } from "./identity.contract.ts";

describe("AUTH-10: вход первого запуска", () => {
  it("email и пароль от 12 символов проходят", () => {
    const input = { email: "admin@example.test", password: "123456789012" };
    expect(SetupInput.parse(input)).toEqual(input);
  });

  it("пароль из 11 символов, не email и лишнее поле (householdId) — не проходят", () => {
    for (const input of [
      { email: "admin@example.test", password: "12345678901" },
      { email: "не-email", password: "123456789012" },
      { email: "admin@example.test", password: "123456789012", householdId: "x" },
    ]) {
      expect(SetupInput.safeParse(input).success).toBe(false);
    }
  });
});

describe("AUTH-08: вход", () => {
  it("пароль любой непустой длины до 128 — длину старого пароля проверяет сервер", () => {
    expect(SignInInput.safeParse({ email: "a@example.test", password: "x" }).success).toBe(true);
    expect(SignInInput.safeParse({ email: "a@example.test", password: "" }).success).toBe(false);
    expect(
      SignInInput.safeParse({ email: "a@example.test", password: "x".repeat(129) }).success,
    ).toBe(false);
  });
});

describe("AUTH-02, PRIV-01: регистрация", () => {
  const valid = {
    email: "irina@example.test",
    password: "надёжный-пароль-12",
    consents: {
      personalData: { accepted: true, version: "2026-10-26" },
      cloud: { accepted: false, version: "2026-10-26" },
    },
  };

  it("email, пароль от 12 символов, согласие на ПД и ответ про облако — проходят", () => {
    expect(RegisterInput.parse(valid)).toEqual(valid);
  });

  it("без согласия на обработку ПД регистрация не проходит схему", () => {
    for (const personalData of [
      { accepted: false, version: "2026-10-26" },
      { version: "2026-10-26" },
      undefined,
    ]) {
      expect(
        RegisterInput.safeParse({ ...valid, consents: { ...valid.consents, personalData } })
          .success,
      ).toBe(false);
    }
  });

  it("короткий пароль, версия текста не датой, лишнее поле (userId) — не проходят", () => {
    for (const input of [
      { ...valid, password: "12345678901" },
      { ...valid, consents: { ...valid.consents, cloud: { accepted: true, version: "v1" } } },
      { ...valid, userId: "x" },
    ]) {
      expect(RegisterInput.safeParse(input).success).toBe(false);
    }
  });
});

describe("AUTH-03: токен ссылки из письма", () => {
  it("base64url от 16 символов проходит; точки, слэши и короткий — нет", () => {
    expect(VerifyEmailInput.safeParse({ token: "AbcDEF_ghij-KLMN0123" }).success).toBe(true);
    for (const token of ["short", "../../etc/passwd/xx", "a.b.c.d.e.f.g.h.i.j"]) {
      expect(VerifyEmailInput.safeParse({ token }).success).toBe(false);
    }
  });
});
