// SEC-01: подсказка надёжности пароля на регистрации — требования и оценка по длине и разнообразию символов.
import { describe, expect, it } from "vitest";
import { checkPassword } from "./password-strength.ts";

describe("SEC-01: надёжность пароля", () => {
  it("пустой пароль — шкала пуста, требования не выполнены", () => {
    expect(checkPassword("", "irina@example.by")).toEqual({
      rules: { length: false, mix: false, notEmail: false },
      level: "none",
      filled: 0,
      ok: false,
    });
  });

  it("короткий из одних букв — слабый, требования не выполнены", () => {
    expect(checkPassword("пароль", "irina@example.by")).toMatchObject({
      level: "weak",
      filled: 1,
      ok: false,
    });
  });

  it("12 символов с буквами и цифрами — требования выполнены, средний", () => {
    expect(checkPassword("кошт2026весна", "irina@example.by")).toMatchObject({
      rules: { length: true, mix: true, notEmail: true },
      level: "medium",
      ok: true,
    });
  });

  it("длинный, с цифрами, знаками и разным регистром — надёжный, шкала заполнена", () => {
    expect(checkPassword("Кошт-2026-Весна!", "irina@example.by")).toMatchObject({
      level: "strong",
      filled: 4,
      ok: true,
    });
  });

  it("пароль совпадает с email или содержит его имя — требование «не совпадает с email» не выполнено", () => {
    expect(checkPassword("irina.k@example.by", "Irina.K@example.by").rules.notEmail).toBe(false);
    expect(checkPassword("irinakov2026x", "irinakov@example.by").rules.notEmail).toBe(false);
    expect(checkPassword("ira123456789x", "ira@example.by").rules.notEmail).toBe(true);
  });
});
