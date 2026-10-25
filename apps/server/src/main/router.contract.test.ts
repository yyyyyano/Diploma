import { contract } from "@kosht/contract";
import { testScope } from "@kosht/testing";
import type { ContractRouterClient } from "@orpc/contract";
import { createRouterClient } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";
import type { ScopedDb } from "../platform/db/scoped-db.ts";
import { memoryLogger } from "../platform/logging/__fixtures__/memory-logger.ts";
import { createApiHandler } from "../platform/http/api.ts";
import { createApp } from "../platform/http/app.ts";
import type { HttpContext } from "../platform/http/procedures.ts";
import type { Session } from "../platform/http/session.ts";
import { createRealtimeHub } from "../platform/realtime/hub.ts";
import { BODY_LIMIT } from "../platform/http/body-limit.ts";
import { publicProc } from "../platform/http/procedures.ts";
import { createAccountsModule, type AccountsFacades } from "../modules/accounts/index.ts";
import type { Platform } from "../platform/module/define-module.ts";
import { contractPaths, routerPaths } from "./__fixtures__/router-paths.ts";
import { createRouter } from "./router.ts";

const scopeA = testScope({ user: 1, household: 1 });
const scopeB = testScope({ user: 2, household: 2 });
const receiptId = "0190f0a0-0000-7000-8000-000000000001";

// Поток событий данных не читает: из ScopedDb нужен только scope (uid в контексте лога), запросов нет.
function sessionOf(scope = scopeA): Session {
  return { s: { scope } as ScopedDb, role: "user" };
}
const signedIn = sessionOf();

const hub = createRealtimeHub({ log: memoryLogger().log });
const router = createRouter({ streams: hub });

// Ветка accounts — из фабрики модуля: порты платформы процедуре списка без сессии не нужны.
const accountsBranch =
  createAccountsModule({ platform: {} as Platform, facades: {} as AccountsFacades }).router ?? {};

function context(overrides: Partial<HttpContext> = {}): HttpContext {
  return {
    requestId: "req-contract-1",
    listener: "local",
    session: async () => undefined,
    shutdownSignal: new AbortController().signal,
    ...overrides,
  };
}

describe("ADR-0005: дерево процедур реализует контракт", () => {
  it("system.health доступна гостю и отвечает { status: ok }", async () => {
    const client = createRouterClient(router, { context: context() });
    expect(await client.system.health()).toEqual({ status: "ok" });
  });

  it("GET /api/system/health через HTTP — 200 { status: ok }", async () => {
    const log = memoryLogger().log;
    const app = createApp({
      listener: "local",
      trustedOrigins: [],
      log,
      ready: async () => {},
      api: {
        handler: createApiHandler(router, log),
        session: async () => undefined,
        shutdownSignal: new AbortController().signal,
        bodyLimit: async () => BODY_LIMIT.default,
      },
    });
    const response = await app.fetch(
      new Request("http://127.0.0.1:8140/api/system/health", {
        headers: { host: "127.0.0.1:8140" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("events.stream без сессии → UNAUTHORIZED", async () => {
    const client = createRouterClient(router, { context: context() });
    const error: unknown = await client.events.stream().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("events.stream с сессией завершается, когда процесс начинает остановку", async () => {
    const shutdown = new AbortController();
    const client = createRouterClient(router, {
      context: context({ session: async () => signedIn, shutdownSignal: shutdown.signal }),
    });
    const stream = await client.events.stream();
    const received: unknown[] = [];
    const reading = (async () => {
      for await (const event of stream) received.push(event);
    })();
    shutdown.abort();
    await reading;
    expect(received).toEqual([]);
  });

  it("events.stream завершается и когда клиент закрыл запрос", async () => {
    const request = new AbortController();
    const client = createRouterClient(router, {
      context: context({ session: async () => signedIn }),
    });
    const stream = await client.events.stream(undefined, { signal: request.signal });
    const reading = (async () => {
      for await (const event of stream) expect(event).toBeUndefined();
    })();
    request.abort();
    await expect(reading).resolves.toBeUndefined();
  });

  it("events.stream отдаёт сигналы домохозяйства сессии и не отдаёт чужие", async () => {
    const request = new AbortController();
    const client = createRouterClient(router, {
      context: context({ session: async () => signedIn }),
    });
    const stream = await client.events.stream(undefined, { signal: request.signal });
    const next = stream.next();
    // Поток регистрируется в хабе, когда oRPC впервые просит событие (после проверки сессии).
    await vi.waitFor(() => expect(hub.size).toBe(1));
    // Барьер: сигнал B, затем «часовой» A — первым в поток A приходит часовой.
    hub.deliver({
      householdId: scopeB.householdId,
      type: "changed",
      entity: "receipt",
      ids: [receiptId],
    });
    hub.deliver({
      householdId: scopeA.householdId,
      type: "progress",
      entity: "receipt",
      ids: [receiptId],
      percent: 50,
    });
    expect(await next).toEqual({
      done: false,
      value: { type: "progress", entity: "receipt", id: receiptId, percent: 50 },
    });
    request.abort();
  });

  it("поток, закрытый хабом, заканчивается причиной (событие done), а не ошибкой", async () => {
    const client = createRouterClient(router, {
      context: context({ session: async () => sessionOf(scopeB) }),
    });
    const stream = await client.events.stream();
    const next = stream.next();
    await vi.waitFor(() => expect(hub.size).toBe(1));
    hub.closeAll("reconnect");
    expect(await next).toEqual({ done: true, value: "reconnect" });
  });
});

describe("ADR-0005: ветки модулей из реестра", () => {
  it("без веток модулей дерево — ровно платформенные ветки контракта (system, events)", () => {
    expect(routerPaths(createRouter({ streams: hub, modules: {} }))).toEqual(
      contractPaths(contract).filter((path) => /^(system|events)\./.test(path)),
    );
  });

  it("ветка модуля встаёт под свой ключ, пустая ветка допустима", () => {
    const tree = createRouter({ streams: hub, modules: { accounts: accountsBranch, fxRates: {} } });
    expect(Object.keys(tree).toSorted()).toEqual(["accounts", "events", "fxRates", "system"]);
    expect(routerPaths(tree)).toEqual(["accounts.list", "events.stream", "system.health"]);
  });

  it("ветка модуля system дополняет общую ветку контракта, health остаётся платформенным", async () => {
    const tree = createRouter({
      streams: hub,
      modules: {
        system: { ping: publicProc.system.health.handler(() => ({ status: "ok" as const })) },
      },
    });
    expect(routerPaths(tree)).toEqual(["events.stream", "system.health", "system.ping"]);
    const client = createRouterClient(tree, { context: context() });
    expect(await client.system.health()).toEqual({ status: "ok" });
  });

  it("процедура с именем платформенной в ветке модуля — ошибка при сборке", () => {
    const health = publicProc.system.health.handler(() => ({ status: "ok" as const }));
    expect(() => createRouter({ streams: hub, modules: { system: { health } } })).toThrow(
      /system\.health/,
    );
  });
});

describe("ROLE-01: процедуры модулей требуют входа", () => {
  it("accounts.list без сессии → UNAUTHORIZED", async () => {
    const tree = createRouter({ streams: hub, modules: { accounts: accountsBranch } });
    // Ветки модулей приходят реестром (запись по строковому ключу): тип клиента — по контракту.
    const client = createRouterClient(tree, {
      context: context(),
    }) as unknown as ContractRouterClient<typeof contract>;
    const error: unknown = await client.accounts.list().catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
