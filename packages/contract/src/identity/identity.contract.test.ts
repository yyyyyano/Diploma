// AUTH-10, SEC-01: вход первого запуска и формы входа — пароль администратора не короче 12 символов, владельца во
// входе нет, лишние поля не проходят.
import { describe, expect, it } from "vitest";
import { SetupInput, SignInInput } from "./identity.contract.ts";

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
