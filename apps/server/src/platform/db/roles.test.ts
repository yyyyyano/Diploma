// Роль приложения (ADR-0020): verifier пароля и текст выдачи прав — без базы; поведение в Postgres —
// roles.int.test.ts.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import {
  AppRoleError,
  appRoleGrants,
  assertAppRole,
  ensureAppRole,
  scramMatches,
  scramVerifier,
} from "./roles.ts";

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

/** Пул-заглушка: отвечает на запросы функцией, соединение — тот же объект. */
function fakePool(answer: (text: string) => unknown): pg.Pool {
  const client = {
    query: (text: string) => {
      try {
        return Promise.resolve(answer(text));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    release: () => undefined,
  };
  return { ...client, connect: () => Promise.resolve(client) } as unknown as pg.Pool;
}

describe("ADR-0020: подсказка отказа assertAppRole по причине", () => {
  const row = (overrides: Record<string, boolean>) => ({
    rows: [
      {
        superuser: false,
        createdb: false,
        createrole: false,
        replication: false,
        bypassrls: false,
        "member-of-role": false,
        "create-on-public": false,
        ...overrides,
      },
    ],
  });

  it("суперпользователь (старый .env с владельцем) — make init, без revoke", async () => {
    const error = await assertAppRole(fakePool(() => row({ superuser: true }))).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppRoleError);
    expect(String(error)).toContain("make init");
    expect(String(error)).not.toContain("revoke");
  });

  it("членство в роли и CREATE на public (выдано вручную) — команды revoke, без make init", async () => {
    const error = await assertAppRole(
      fakePool(() => row({ "member-of-role": true, "create-on-public": true })),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppRoleError);
    expect(String(error)).toContain("revoke <роль> from <роль приложения>");
    expect(String(error)).toContain("revoke create on schema public from <роль приложения>");
    expect(String(error)).not.toContain("make init");
  });
});

describe("ADR-0020: ensureAppRole при оборванном соединении", () => {
  it("rollback тоже падает — наружу уходит исходная ошибка, а не ошибка rollback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kosht-roles-unit-"));
    try {
      const passwordFile = join(dir, "db_app_password");
      writeFileSync(passwordFile, "0123abcd", { mode: 0o600 });
      const cause = Object.assign(new Error("connection terminated"), { code: "XX000" });
      const pool = fakePool((text) => {
        if (text.startsWith("set local")) throw cause;
        if (text === "rollback") throw new Error("rollback: not connected");
        return { rows: [] };
      });
      await expect(
        ensureAppRole(pool, { appRole: "kosht_app", passwordFile, schemas: ["public"] }),
      ).rejects.toBe(cause);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
