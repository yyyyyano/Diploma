// Роль приложения (ADR-0020): verifier пароля и текст выдачи прав — без базы; поведение в Postgres —
// roles.int.test.ts.
import { describe, expect, it } from "vitest";
import { appRoleGrants, scramMatches, scramVerifier } from "./roles.ts";

describe("ADR-0020: SCRAM-SHA-256 verifier вместо пароля в ALTER ROLE", () => {
  it("verifier в формате pg_authid и без пароля в тексте", () => {
    const verifier = scramVerifier("0123abcd");
    expect(verifier).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/,
    );
    expect(verifier).not.toContain("0123abcd");
  });

  it("соль случайная: два verifier одного пароля различны, оба подходят к паролю", () => {
    const first = scramVerifier("pass-1");
    const second = scramVerifier("pass-1");
    expect(first).not.toBe(second);
    expect(scramMatches(first, "pass-1")).toBe(true);
    expect(scramMatches(second, "pass-1")).toBe(true);
  });

  it("другой пароль, пустой или не SCRAM-verifier (md5, NULL) — не совпадает", () => {
    const verifier = scramVerifier("pass-1");
    expect(scramMatches(verifier, "pass-2")).toBe(false);
    expect(scramMatches(null, "pass-1")).toBe(false);
    expect(scramMatches("md5d41d8cd98f00b204e9800998ecf8427e", "pass-1")).toBe(false);
  });
});

describe("ADR-0020: выдача прав роли приложения", () => {
  const grants = appRoleGrants({ appRole: "kosht_app", owner: "kosht", schemas: ["public"] });

  it("только DML на таблицах схемы и права по умолчанию на будущие таблицы владельца", () => {
    expect(grants).toContain(
      'grant select, insert, update, delete on all tables in schema "public" to "kosht_app"',
    );
    expect(grants).toContain(
      'alter default privileges for role "kosht" in schema "public" grant select, insert, update, delete on tables to "kosht_app"',
    );
    expect(grants.join("\n")).not.toMatch(
      /grant[^\n]*(truncate|references|trigger|all privileges)/,
    );
  });

  it("CREATE на public у PUBLIC и статистика планировщика закрыты", () => {
    expect(grants).toContain("revoke create on schema public from public");
    expect(grants).toContain(
      "revoke select on pg_catalog.pg_stats, pg_catalog.pg_stats_ext, pg_catalog.pg_stats_ext_exprs from public",
    );
  });

  it("каждая схема из списка получает свои права (T-006 добавит pgboss)", () => {
    const two = appRoleGrants({
      appRole: "kosht_app",
      owner: "kosht",
      schemas: ["public", "pgboss"],
    });
    expect(two).toContain('grant usage on schema "pgboss" to "kosht_app"');
    expect(two.filter((line) => line.startsWith("alter default privileges"))).toHaveLength(4);
  });

  it.each([
    ["роль с кавычкой", { appRole: 'app"; drop', owner: "kosht", schemas: ["public"] }],
    ["заглавные буквы", { appRole: "Kosht_App", owner: "kosht", schemas: ["public"] }],
    ["схема с точкой", { appRole: "kosht_app", owner: "kosht", schemas: ["pg_catalog.x"] }],
  ])("имя не из [a-z0-9_] (%s) — ошибка до SQL", (_name, options) => {
    expect(() => appRoleGrants(options)).toThrow(RangeError);
  });
});
