// Роль приложения без суперпользователя (ADR-0020, ROLE-01, SEC-04, PRIV-07) на настоящем Postgres. База — клон
// шаблона: права, отзыв pg_stats и права по умолчанию приходят с клоном, как у каждого тестового файла.
// Запреты проверяются сырым pg.Client под kosht_app — мимо аудитора: права роли — отдельный замок. Порча роли и
// гонки — на своих ролях test_*: kosht_app общая для кластера, на ней параллельно идут остальные файлы.
import { testScope } from "@kosht/testing";
import { createTestDb, dropTestRole, testRoleName, type TestDb } from "@kosht/testing/db";
import { eq } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { settings } from "../settings/schema.ts";
import { migrateFixtures } from "./__fixtures__/fixture-db.ts";
import { fxReceipts } from "./__fixtures__/schema.ts";
import { AppRoleError, assertAppRole, ensureAppRole } from "./roles.ts";
import { createScopedDb } from "./scoped-db.ts";
import { createSystemDb } from "./system-db.ts";

const context = inject("testDb");
const dir = mkdtempSync(join(tmpdir(), "kosht-roles-"));
const roles: string[] = [];
const extraDbs: TestDb[] = [];
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
  for (const extra of extraDbs) await extra.drop();
  // Права роли живут в базах: роль удаляется после них.
  for (const role of roles) await dropTestRole(context.admin, role);
  rmSync(dir, { recursive: true, force: true });
});

/** Своя роль test_* с паролем в своём файле. */
function newRole(): { name: string; password: string; passwordFile: string } {
  const name = testRoleName();
  roles.push(name);
  const password = randomBytes(16).toString("hex");
  const passwordFile = join(dir, name);
  writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
  return { name, password, passwordFile };
}

const ensure = (owner: pg.Pool, role: { name: string; passwordFile: string }) =>
  ensureAppRole(owner, {
    appRole: role.name,
    passwordFile: role.passwordFile,
    schemas: ["public"],
  });

/** Сырой клиент под ролью — мимо аудитора и пулов приложения. */
async function connectAs(user: string, password: string, database = db.name): Promise<pg.Client> {
  const client = new pg.Client({ ...context.admin, user, password, database });
  await client.connect();
  return client;
}

async function errorCode(client: pg.Client, text: string): Promise<string | undefined> {
  try {
    await client.query(text);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function attributes(name: string) {
  const { rows } = await db.owner.query(
    `select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin
       from pg_roles where rolname = $1`,
    [name],
  );
  return rows[0] as Record<string, boolean> | undefined;
}

const HARMLESS = {
  rolsuper: false,
  rolcreatedb: false,
  rolcreaterole: false,
  rolreplication: false,
  rolbypassrls: false,
  rolcanlogin: true,
};

describe("ADR-0020: kosht_app не выходит за чтение и запись строк — отказ 42501 мимо аудитора", () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = await connectAs(context.app.user, context.app.password);
  });
  afterAll(async () => {
    await app.end();
  });

  it("приложение подключено ролью без административных прав", async () => {
    expect(await attributes(context.app.user)).toEqual(HARMLESS);
  });

  it.each([
    ["pg_read_binary_file — страницы таблиц с диска", "select pg_read_binary_file('PG_VERSION')"],
    ["COPY … TO PROGRAM", "copy (select 1) to program 'true'"],
    ["COPY … FROM PROGRAM", "copy settings from program 'true'"],
    ["lo_import файла сервера", "select lo_import('/etc/passwd')"],
    ["CREATE TABLE", "create table fx_by_app (n int)"],
    ["CREATE SCHEMA", "create schema fx_by_app"],
    ["CREATE EXTENSION dblink (есть в образе, недоверенное)", "create extension dblink"],
    ["CREATE ROLE", "create role fx_by_app"],
    ["CREATE DATABASE", "create database fx_by_app"],
    ["ALTER TABLE settings", "alter table settings add column fx int"],
    ["TRUNCATE settings", "truncate settings"],
    ["SET ROLE владельца", `set role "${context.admin.user}"`],
    ["ALTER ROLE … SUPERUSER", `alter role "${context.app.user}" superuser`],
    ["select из pg_stats — частые значения колонок", "select * from pg_stats"],
    ["select из pg_stats_ext", "select * from pg_stats_ext"],
    ["select из pg_stats_ext_exprs", "select * from pg_stats_ext_exprs"],
    ["select из pg_statistic", "select * from pg_statistic"],
    ["select из журнала миграций drizzle", "select * from drizzle.__drizzle_migrations"],
  ])("%s → 42501", async (_name, text) => {
    expect(await errorCode(app, text)).toBe("42501");
  });

  it("dblink в образе есть: отказ — именно право, а не отсутствие расширения", async () => {
    const { rows } = await db.owner.query(
      "select count(*)::int as n from pg_available_extensions where name = 'dblink'",
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("assertAppRole пропускает роль приложения", async () => {
    await expect(assertAppRole(db.pool)).resolves.toBeUndefined();
  });
});

describe("ADR-0020: DML роли приложения работает", () => {
  it("ScopedDb пишет и читает таблицу, созданную владельцем после выдачи прав (права по умолчанию)", async () => {
    await migrateFixtures(db.owner);
    const s = createScopedDb(db.pool, testScope({ user: 1, household: 1 }));
    await s.insert(fxReceipts).values({ merchant: "магазин", totalMinor: 100, note: "n" });
    const rows = await s.db.select().from(fxReceipts).where(s.own(fxReceipts));
    expect(rows).toHaveLength(1);
    await s.delete(fxReceipts, eq(fxReceipts.note, "n"));
  });

  it("SystemDb пишет, правит и удаляет строку системной таблицы", async () => {
    const system = createSystemDb(db.pool);
    await system.insert(settings).values({ key: "fx.k", value: "1", updatedAt: new Date() });
    await system.update(settings).set({ value: "2" }).where(eq(settings.key, "fx.k"));
    const rows = await system.select().from(settings).where(eq(settings.key, "fx.k"));
    expect(rows.map((row) => row.value)).toEqual(["2"]);
    await system.delete(settings).where(eq(settings.key, "fx.k"));
  });
});

describe("ADR-0020: ensureAppRole на своей роли", () => {
  it("GRANT … ON ALL TABLES покрывает таблицу, созданную владельцем до выдачи прав", async () => {
    await db.owner.query("create table fx_before_grant (n int)");
    const role = newRole();
    await ensure(db.owner, role);
    const client = await connectAs(role.name, role.password);
    try {
      await client.query("insert into fx_before_grant values (1)");
      const { rows } = await client.query("select n from fx_before_grant");
      expect(rows).toEqual([{ n: 1 }]);
      expect(await errorCode(client, "truncate fx_before_grant")).toBe("42501");
    } finally {
      await client.end();
    }
  });

  it("повтор ничего не меняет: пароль в pg_authid тот же, вход и DML работают", async () => {
    const role = newRole();
    await ensure(db.owner, role);
    const verifier = async () =>
      (
        await db.owner.query<{ rolpassword: string }>(
          "select rolpassword from pg_authid where rolname = $1",
          [role.name],
        )
      ).rows[0]?.rolpassword;
    const before = await verifier();
    await ensure(db.owner, role);
    expect(await verifier()).toBe(before);
    expect(before).toMatch(/^SCRAM-SHA-256\$4096:/);
    const client = await connectAs(role.name, role.password);
    await client.query("select count(*) from settings");
    await client.end();
  });

  it("после ручной порчи (SUPERUSER, CREATEDB, …, NOLOGIN) повтор возвращает атрибуты", async () => {
    const role = newRole();
    await ensure(db.owner, role);
    await db.owner.query(
      `alter role "${role.name}" superuser createdb createrole replication bypassrls nologin`,
    );
    await ensure(db.owner, role);
    expect(await attributes(role.name)).toEqual(HARMLESS);
  });

  it("новый пароль в файле: входит новым, старый отвергнут (28P01)", async () => {
    const role = newRole();
    await ensure(db.owner, role);
    const next = randomBytes(16).toString("hex");
    writeFileSync(role.passwordFile, next);
    await ensure(db.owner, role);
    const client = await connectAs(role.name, next);
    await client.end();
    await expect(connectAs(role.name, role.password)).rejects.toMatchObject({ code: "28P01" });
  });

  it("параллельно из трёх баз (блокировка — на базу, роль — на кластер): все успешны, роль одна", async () => {
    const dbs = [await createTestDb(), await createTestDb(), await createTestDb()];
    extraDbs.push(...dbs);
    const role = newRole();
    // Сначала создание наперегонки (CREATE ROLE → 23505/42710), затем порча и правка наперегонки (ALTER ROLE → XX000).
    await Promise.all(dbs.map((each) => ensure(each.owner, role)));
    await db.owner.query(`alter role "${role.name}" superuser createdb`);
    await Promise.all(dbs.map((each) => ensure(each.owner, role)));
    expect(await attributes(role.name)).toEqual(HARMLESS);
    for (const each of dbs) {
      const client = await connectAs(role.name, role.password, each.name);
      await client.query("select count(*) from settings");
      await client.end();
    }
  });

  it("роль приложения = владелец (старый .env) → AppRoleError, права владельца не сняты", async () => {
    const passwordFile = join(dir, "owner");
    writeFileSync(passwordFile, context.admin.password);
    await expect(
      ensureAppRole(db.owner, { appRole: context.admin.user, passwordFile, schemas: ["public"] }),
    ).rejects.toThrow(AppRoleError);
    expect((await attributes(context.admin.user))?.["rolsuper"]).toBe(true);
  });
});

describe("ADR-0020: assertAppRole — старт отказывает роли с лишними правами", () => {
  it("владелец (суперпользователь) → AppRoleError со списком признаков и подсказкой make init", async () => {
    const error = await assertAppRole(db.owner).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppRoleError);
    const message = (error as Error).message;
    expect(message).toContain("суперпользователь, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS");
    expect(message).toContain("make init");
    expect(message).not.toContain(context.admin.password);
  });

  it.each([
    ["членство в pg_read_server_files", "grant pg_read_server_files to", "членство в другой роли"],
    ["CREATE на public", "grant create on schema public to", "CREATE на схеме public"],
  ])("%s → AppRoleError", async (_name, grant, expected) => {
    const role = newRole();
    await ensure(db.owner, role);
    await db.owner.query(`${grant} "${role.name}"`);
    const pool = new pg.Pool({
      ...context.admin,
      user: role.name,
      password: role.password,
      database: db.name,
      max: 1,
    });
    try {
      await expect(assertAppRole(pool)).rejects.toThrow(expected);
    } finally {
      await pool.end();
    }
  });
});

describe("ADR-0020, NFR-16: пароль роли не попадает в лог Postgres", () => {
  it("даже при log_statement = all на соединении владельца: ни пароля, ни verifier в логах контейнера db", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const marker = `fx-log-marker-${randomBytes(6).toString("hex")}`;
    // Владелец с записью всех команд в лог — как кластер с log_statement = all.
    const loud = new pg.Pool({
      ...context.admin,
      database: db.name,
      max: 1,
      options: "-c log_statement=all -c log_min_duration_statement=0",
    });
    const role = newRole();
    try {
      await loud.query(`select '${marker}'`);
      await ensure(loud, role);
    } finally {
      await loud.end();
    }
    const { rows } = await db.owner.query<{ rolpassword: string }>(
      "select rolpassword from pg_authid where rolname = $1",
      [role.name],
    );
    // SCRAM-SHA-256$<итерации>:<соль>$<StoredKey>:<ServerKey> — ключи verifier.
    const keys = (rows[0]?.rolpassword ?? "").split("$")[2] ?? "";
    const root = fileURLToPath(new URL("../../../../../", import.meta.url));
    const logs = await vi.waitFor(
      () => {
        const text = execFileSync(
          "docker",
          ["compose", "logs", "--no-log-prefix", "--since", since, "db"],
          { cwd: root, encoding: "utf8" },
        );
        // Запись всех команд действительно включена: метка в логе есть.
        expect(text).toContain(marker);
        return text;
      },
      { timeout: 5000, interval: 100 },
    );
    expect(logs).not.toContain(role.password);
    expect(keys).not.toBe("");
    expect(logs).not.toContain(keys);
    expect(logs).not.toContain("SCRAM-SHA-256$");
  });
});
