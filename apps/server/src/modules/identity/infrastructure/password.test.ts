import { describe, expect, it } from "vitest";
import { ARGON2_PARAMS, hashPassword, verifyPassword } from "./password.ts";

describe("SEC-01: пароль — только стойкий хэш argon2id", () => {
  it("хэш — строка PHC argon2id с m = 64 МиБ, t = 3, p = 1 и без самого пароля", async () => {
    const hash = await hashPassword("очень-длинный-пароль");
    expect(hash).toMatch(
      /^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    expect(hash).not.toContain("очень-длинный-пароль");
    expect(ARGON2_PARAMS).toEqual({ memoryKiB: 65_536, passes: 3, parallelism: 1 });
  });

  it("одинаковые пароли дают разные хэши: соль случайная", async () => {
    expect(await hashPassword("одинаковый-пароль")).not.toBe(
      await hashPassword("одинаковый-пароль"),
    );
  });

  it("верный пароль проходит проверку, неверный — нет", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword({ hash, password: "correct horse battery" })).toBe(true);
    expect(await verifyPassword({ hash, password: "correct horse batterY" })).toBe(false);
  });

  it("испорченная или чужая строка хэша — не проходит, а не падает", async () => {
    const hash = await hashPassword("пароль-для-порчи");
    for (const broken of [
      "",
      "plain-text",
      hash.replace("argon2id", "argon2i"),
      hash.replace("m=65536", "m=8"),
      hash.slice(0, -4),
      `${hash}$лишнее`,
    ]) {
      expect(await verifyPassword({ hash: broken, password: "пароль-для-порчи" })).toBe(false);
    }
  });
});
