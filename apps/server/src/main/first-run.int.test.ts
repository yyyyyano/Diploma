// Сквозной срез на настоящих корне композиции, HTTP и очереди (AUTH-10, AUTH-08, STMT-01, ROLE-01, SEC-04): первый
// запуск только с локального входа и один раз → вход по cookie kosht_session → worker создаёт «Наличные» по событию
// → список счетов по сессии → выход. Владелец задачи перепроверяется identity: чужое домохозяйство в конверте —
// задача отброшена.
import { HouseholdId, makeScope, UserId } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { loadConfig, type AppConfig } from "../platform/config/config.ts";
import { createApiHandler } from "../platform/http/api.ts";
import { createApp, type HttpApp } from "../platform/http/app.ts";
import { BODY_LIMIT } from "../platform/http/body-limit.ts";
import type { ListenerName } from "../platform/http/guard.ts";
import { memoryLogger } from "../platform/logging/__fixtures__/memory-logger.ts";
import { compose, type Composition } from "./compose.ts";
import { TEST_POOL_MAX } from "./__fixtures__/compose-on-test-db.ts";

let db: TestDb;
let dir: string;
let config: AppConfig;
let api: Composition;
let worker: Composition;
const apps = new Map<ListenerName, HttpApp>();

beforeAll(async () => {
  db = await createTestDb();
  dir = await mkdtemp(join(tmpdir(), "kosht-first-run-"));
  const { app, admin } = inject("testDb");
  await writeFile(join(dir, "db_app_password"), app.password, { mode: 0o600 });
  await writeFile(join(dir, "db_password"), admin.password, { mode: 0o600 });
  await writeFile(join(dir, "master.key"), randomBytes(32), { mode: 0o600 });
  config = loadConfig({
    DATABASE_URL: `postgres://${app.user}@${app.host}:${String(app.port)}/${db.name}`,
    DB_PASSWORD_FILE: join(dir, "db_app_password"),
    MIGRATION_DATABASE_URL: `postgres://${admin.user}@${admin.host}:${String(admin.port)}/${db.name}`,
    MIGRATION_DB_PASSWORD_FILE: join(dir, "db_password"),
    MASTER_KEY_FILE: join(dir, "master.key"),
    // Тесты офлайн (NFR-11): трассы не уходят в Langfuse, даже если make init создал ключи.
    LANGFUSE_ENABLED: "false",
    DATA_DIR: join(dir, "data"),
  });
  api = await compose(config, "api", { log: memoryLogger().log, poolMax: TEST_POOL_MAX });
  worker = await compose(config, "worker", {
    log: memoryLogger().log,
    poolMax: TEST_POOL_MAX,
  });
  await api.startJobs();
  await worker.startJobs();
  const log = memoryLogger().log;
  const handler = createApiHandler(api.router, log);
  for (const listener of ["local", "lan"] as const) {
    apps.set(
      listener,
      createApp({
        listener,
        trustedOrigins: [],
        log,
        ready: () => api.ready(),
        api: {
          handler,
          session: (headers) => api.session(headers),
          shutdownSignal: new AbortController().signal,
          bodyLimit: async () => BODY_LIMIT.default,
        },
      }),
    );
  }
});

afterAll(async () => {
  await worker.close();
  await api.close();
  await db.drop();
  await rm(dir, { recursive: true, force: true });
});

const HOST: Record<ListenerName, string> = { local: "127.0.0.1:8140", lan: "192.168.1.5:8141" };

/** Запрос к процедуре через HTTP-приложение слушателя (как браузер: Host и cookie). */
async function call(
  listener: ListenerName,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const app = apps.get(listener);
  if (app === undefined) throw new Error("нет приложения");
  const headers = new Headers({ host: HOST[listener] });
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  const init: RequestInit = { headers };
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    init.method = "POST";
    init.body = JSON.stringify(options.body);
  }
  if (path.endsWith("sign-out")) init.method = "POST";
  return await app.fetch(new Request(`http://${HOST[listener]}/api${path}`, init));
}

const admin = { email: "admin@example.test", password: "пароль-администратора" };

/** cookie сессии из ответа входа: «kosht_session=…» без атрибутов. */
function sessionCookie(response: Response): string {
  const header = response.headers.getSetCookie().find((c) => c.startsWith("kosht_session="));
  if (header === undefined) throw new Error("нет cookie kosht_session");
  return header.split(";")[0] ?? "";
}

describe("AUTH-10, NFR-24: первый запуск — только локальный вход и один раз", () => {
  it("до первого запуска: локально экран доступен, по сети — нет (status и setup)", async () => {
    expect(await (await call("local", "/identity/status")).json()).toEqual({
      initialized: false,
      setupAvailable: true,
    });
    expect(await (await call("lan", "/identity/status")).json()).toEqual({
      initialized: false,
      setupAvailable: false,
    });
    const fromLan = await call("lan", "/identity/setup", { body: admin });
    expect(fromLan.status).toBe(404);
    expect(await fromLan.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("пароль короче 12 символов — VALIDATION, система не инициализирована", async () => {
    const short = await call("local", "/identity/setup", {
      body: { email: admin.email, password: "короткий" },
    });
    expect(await short.json()).toMatchObject({ code: "VALIDATION" });
    expect(await (await call("local", "/identity/status")).json()).toMatchObject({
      initialized: false,
    });
  });

  it("setup создаёт администратора; повтор — CONFLICT, экран больше не доступен", async () => {
    expect((await call("local", "/identity/setup", { body: admin })).status).toBe(200);
    expect(await (await call("local", "/identity/status")).json()).toEqual({
      initialized: true,
      setupAvailable: false,
    });
    const again = await call("local", "/identity/setup", {
      body: { ...admin, email: "second@example.test" },
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "CONFLICT" });
  });
});

describe("AUTH-08, STMT-01: вход, «Наличные», выход", () => {
  it("неверный пароль — 401 INVALID_CREDENTIALS без cookie", async () => {
    const wrong = await call("local", "/identity/sign-in", {
      body: { ...admin, password: "неверный-пароль-1" },
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(wrong.headers.getSetCookie()).toEqual([]);
  });

  it("вход (email в другом регистре) → cookie → «Наличные · 0 BYN» от worker; выход снимает сессию", async () => {
    const signIn = await call("local", "/identity/sign-in", {
      body: { ...admin, email: "Admin@Example.TEST" },
    });
    expect(signIn.status).toBe(200);
    expect(await signIn.json()).toEqual({
      email: admin.email,
      name: "",
      role: "admin",
      emailVerified: false,
    });
    const [header] = signIn.headers.getSetCookie();
    expect(header).toMatch(/^kosht_session=[^;]+;.*HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    const cookie = sessionCookie(signIn);

    expect(await (await call("local", "/identity/me", { cookie })).json()).toEqual({
      email: admin.email,
      name: "",
      role: "admin",
      emailVerified: false,
    });
    // «Наличные» создаёт подписка accounts в worker по событию identity.user-registered.
    const items = await vi.waitFor(
      async () => {
        const body = (await (await call("local", "/accounts", { cookie })).json()) as {
          items: unknown[];
        };
        expect(body.items).toHaveLength(1);
        return body.items;
      },
      { timeout: 15_000, interval: 200 },
    );
    expect(items).toMatchObject([
      {
        id: expect.any(String),
        kind: "cash",
        name: null,
        balance: { minor: 0, currency: "BYN" },
        balanceSource: "manual",
      },
    ]);

    const out = await call("local", "/identity/sign-out", { cookie });
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().some((c) => c.startsWith("kosht_session=;"))).toBe(true);
    const after = await call("local", "/accounts", { cookie });
    expect(after.status).toBe(401);
    expect(await after.json()).toMatchObject({ code: "UNAUTHORIZED" });
  }, 30_000);

  it("без cookie счета не отдаются — UNAUTHORIZED", async () => {
    const response = await call("local", "/accounts");
    expect(response.status).toBe(401);
  });
});

describe("SEC-04: identity перепроверяет владельца задачи", () => {
  it("задача с чужим householdId в конверте отброшена: счёт не создан, в журнале — dropped", async () => {
    const { rows } = await db.owner.query<{ id: string }>("select id from identity_users");
    const userId = UserId.parse(rows[0]?.id);
    const forged = HouseholdId.parse("0190f0a0-0000-7000-8000-0000000000ff");
    const subscription = api.registries.subscriptions.find(
      (s) => s.event.name === "identity.user-registered" && s.module === "accounts",
    );
    if (subscription === undefined) throw new Error("нет подписки accounts");
    await api.platform
      .scoped(makeScope({ userId, householdId: forged }))
      .transaction((tx) => api.jobs.enqueue(tx, subscription.job, { ids: [userId] }));
    await vi.waitFor(
      async () => {
        const run = await db.owner.query<{ status: string; error_code: string | null }>(
          "select status, error_code from background_job_run where kind = $1 and status = 'dropped'",
          [subscription.job.name],
        );
        expect(run.rows).toEqual([{ status: "dropped", error_code: "FORBIDDEN" }]);
      },
      { timeout: 15_000, interval: 200 },
    );
    const forgedAccounts = await db.owner.query("select 1 from accounts where household_id = $1", [
      forged,
    ]);
    expect(forgedAccounts.rows).toEqual([]);
  }, 30_000);
});
