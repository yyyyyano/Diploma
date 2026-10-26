import { testHouseholdId, testUserId } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import { closeLogFile, createLogger, openLogFile, type Logger } from "../logging/logger.ts";
import { createApiHandler } from "./api.ts";
import { createApp } from "./app.ts";
import { BODY_LIMIT } from "./body-limit.ts";
import type { ListenerName } from "./guard.ts";
import { CRASH_TEXT, miniRouter } from "./__fixtures__/mini-router.ts";
import { createSessionRegistry, openSession, type SessionRegistry } from "./session.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

/** Источник сессий тестов: кто вошёл — из заголовков x-test-user / x-test-role. */
function headerSessions(): SessionRegistry {
  const registry = createSessionRegistry();
  registry.register(async (headers) => {
    const user = headers.get("x-test-user");
    if (user === null) return undefined;
    return {
      userId: testUserId(Number(user)),
      householdId: testHouseholdId(Number(user)),
      role: headers.get("x-test-role") === "admin" ? "admin" : "user",
      // Источник продлил сессию — отдаёт новую cookie (identity: Better Auth раз в сутки).
      ...(headers.get("x-test-refresh") === null
        ? {}
        : { cookies: ["kosht_session=renewed; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax"] }),
    };
  });
  return registry;
}

function server(
  options: {
    listener?: ListenerName;
    sessions?: SessionRegistry;
    log?: Logger;
    bodyLimit?: number;
  } = {},
) {
  const log = options.log ?? memoryLogger().log;
  const registry = options.sessions ?? headerSessions();
  const listener = options.listener ?? "local";
  const app = createApp({
    listener,
    trustedOrigins: [],
    log,
    ready: async () => {},
    api: {
      handler: createApiHandler(miniRouter, log),
      session: (headers) => openSession(registry, db.pool, headers),
      shutdownSignal: new AbortController().signal,
      bodyLimit: async () => options.bodyLimit ?? BODY_LIMIT.default,
    },
  });
  const host = listener === "local" ? "127.0.0.1:8140" : "192.168.1.5:8141";
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("host")) headers.set("host", host);
    return app.fetch(new Request(`http://${host}${path}`, { ...init, headers }));
  };
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("ADR-0005, OBS-02: ошибки процедур — код каталога без текста исключения", () => {
  it("тело ошибки — ровно { defined, code, status, message = код, data: { requestId, params } }", async () => {
    const response = await server()("/api/fx/echo", json({ name: "x".repeat(21) }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).toSorted()).toEqual(["code", "data", "defined", "message", "status"]);
    expect(body).toEqual({
      defined: false,
      code: "VALIDATION",
      status: 400,
      message: "VALIDATION",
      data: { requestId: response.headers.get("x-request-id"), params: {} },
    });
  });

  it("вход не по схеме → VALIDATION без issues и без значений из запроса", async () => {
    const response = await server()(
      "/api/fx/echo",
      json({ name: "ivan.petrov@mail.by-слишком-длинно" }),
    );
    const text = await response.text();
    expect(response.status).toBe(400);
    expect(text).not.toContain("ivan.petrov");
    expect(text).not.toContain("issues");
    expect(text).not.toContain("Input validation failed");
  });

  it("битый JSON в теле → VALIDATION, а не INTERNAL; строки http.error нет", async () => {
    const memory = memoryLogger();
    const response = await server({ log: memory.log })("/api/fx/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ не json",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION" });
    expect(memory.lines().some((line) => line["msg"] === "http.error")).toBe(false);
  });

  it("выход не по схеме → INTERNAL без значений; стек — в лог", async () => {
    const memory = memoryLogger();
    const response = await server({ log: memory.log })("/api/fx/bad-output");
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject({ code: "INTERNAL", message: "INTERNAL" });
    expect(text).not.toContain("ivan.petrov");
    expect(memory.lines()).toContainEqual(
      expect.objectContaining({ msg: "http.error", code: "INTERNAL" }),
    );
  });

  it("исключение с email: ни в ответе, ни в файле лога его нет, а стек и код — в файле", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kosht-http-log-"));
    try {
      const stream = await openLogFile(dir, "api");
      const log = createLogger({ role: "api", level: "info", destination: stream });
      const response = await server({ log })("/api/fx/crash");
      const text = await response.text();
      await closeLogFile(stream);
      const file = stream.file ?? "";
      const logText = await readFile(file, "utf8");

      expect(response.status).toBe(500);
      expect(text).not.toContain("ivan.petrov");
      expect(text).not.toContain(CRASH_TEXT);
      expect(logText).not.toContain("ivan.petrov@mail.by");
      const line = logText
        .trim()
        .split("\n")
        .map((entry) => JSON.parse(entry) as Record<string, unknown>)
        .find((entry) => entry["msg"] === "http.error");
      expect(line).toMatchObject({
        code: "INTERNAL",
        requestId: response.headers.get("x-request-id"),
      });
      const err = line?.["err"] as { stack?: string[] } | undefined;
      expect(err?.stack?.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("AppError процедуры → свой код и параметры; объявленный в .errors() — defined: true", async () => {
    const response = await server()("/api/fx/conflict");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      defined: true,
      code: "CONFLICT",
      message: "CONFLICT",
      data: { params: { receiptId: "r-1" } },
    });
  });

  it("неизвестная процедура и голый /api → 404 NOT_FOUND в той же форме, а не HTML", async () => {
    for (const path of ["/api/nope", "/api"]) {
      const response = await server()(path);
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toMatchObject({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }
  });
});

describe("T-009: процедура отдаёт заголовки ответа (Set-Cookie входа)", () => {
  it("две cookie из context.resHeaders приходят двумя заголовками Set-Cookie", async () => {
    const response = await server()("/api/fx/set-cookies", { method: "POST" });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([
      "fx_a=1; Path=/; HttpOnly",
      "fx_b=2; Path=/; HttpOnly",
    ]);
  });
});

describe("T-009: размер тела запроса /api ограничен настройкой", () => {
  it("тело больше предела → 400 VALIDATION, процедура не вызвана; в пределе — 200", async () => {
    const call = server({ bodyLimit: 64 });
    // Вход по схеме (имя короткое), но тело раздуто пробелами: отказ — из-за размера, а не схемы.
    const padded = `${JSON.stringify({ name: "Ира" })}${" ".repeat(200)}`;
    const big = await call("/api/fx/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: padded,
    });
    expect(big.status).toBe(400);
    expect(await big.json()).toMatchObject({ code: "VALIDATION", message: "VALIDATION" });
    const small = await call("/api/fx/echo", json({ name: "Ира" }));
    expect(small.status).toBe(200);
  });

  it("предел проверяется и без Content-Length (потоковое тело)", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(`${JSON.stringify({ name: "Ира" })}${" ".repeat(200)}`),
        );
        controller.close();
      },
    });
    const response = await server({ bodyLimit: 64 })("/api/fx/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION" });
  });
});

describe("ROLE-01: authed и admin — сессия из реестра, не из запроса", () => {
  it("пустой реестр сессий → UNAUTHORIZED", async () => {
    const response = await server({ sessions: createSessionRegistry() })("/api/fx/whoami", {
      headers: { "x-test-user": "1" },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("без сессии → UNAUTHORIZED, с сессией — scope из источника сессий", async () => {
    const call = server();
    expect((await call("/api/fx/whoami")).status).toBe(401);
    const response = await call("/api/fx/whoami", { headers: { "x-test-user": "2" } });
    expect(await response.json()).toEqual({
      userId: testUserId(2),
      householdId: testHouseholdId(2),
      role: "user",
    });
  });

  it("продлённая источником сессия — новая cookie в ответе authed-процедуры; без продления — без Set-Cookie", async () => {
    const call = server();
    const plain = await call("/api/fx/whoami", { headers: { "x-test-user": "2" } });
    expect(plain.headers.getSetCookie()).toEqual([]);
    const renewed = await call("/api/fx/whoami", {
      headers: { "x-test-user": "2", "x-test-refresh": "1" },
    });
    expect(renewed.status).toBe(200);
    expect(renewed.headers.getSetCookie()).toEqual([
      "kosht_session=renewed; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax",
    ]);
  });

  it("второй источник сессий — ошибка при старте", () => {
    const registry = headerSessions();
    expect(() => registry.register(async () => undefined)).toThrow(/уже зарегистрирован/);
  });

  it("admin: роль user → FORBIDDEN, роль admin → 200, без сессии → UNAUTHORIZED", async () => {
    const call = server();
    expect((await call("/api/fx/admin")).status).toBe(401);
    expect((await call("/api/fx/admin", { headers: { "x-test-user": "1" } })).status).toBe(403);
    const admin = await call("/api/fx/admin", {
      headers: { "x-test-user": "1", "x-test-role": "admin" },
    });
    expect(admin.status).toBe(200);
  });
});

describe("R40, NFR-24: localOnly — по слушателю, а не по заголовкам", () => {
  it("на локальном слушателе процедура доступна и без сессии", async () => {
    const response = await server({ listener: "local" })("/api/fx/first-run", { method: "POST" });
    expect(response.status).toBe(200);
  });

  it("на сетевом слушателе — NOT_FOUND, как у несуществующей процедуры", async () => {
    const call = server({ listener: "lan" });
    const response = await call("/api/fx/first-run", { method: "POST" });
    const missing = await call("/api/fx/no-such", { method: "POST" });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { data: { requestId: string } };
    const other = (await missing.json()) as { data: { requestId: string } };
    expect({ ...body, data: { ...body.data, requestId: "" } }).toEqual({
      ...other,
      data: { ...other.data, requestId: "" },
    });
  });

  it("Host 127.0.0.1 и X-Forwarded-* на сетевом слушателе не делают запрос локальным", async () => {
    const response = await server({ listener: "lan" })("/api/fx/first-run", {
      method: "POST",
      headers: {
        host: "127.0.0.1:8140",
        "x-forwarded-for": "127.0.0.1",
        "x-forwarded-host": "localhost:8140",
        "x-real-ip": "127.0.0.1",
      },
    });
    expect(response.status).toBe(404);
  });
});
