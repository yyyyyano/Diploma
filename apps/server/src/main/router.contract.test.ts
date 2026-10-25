import { testScope } from "@kosht/testing";
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import type { ScopedDb } from "../platform/db/scoped-db.ts";
import { memoryLogger } from "../platform/logging/__fixtures__/memory-logger.ts";
import { createApiHandler } from "../platform/http/api.ts";
import { createApp } from "../platform/http/app.ts";
import type { HttpContext } from "../platform/http/procedures.ts";
import type { Session } from "../platform/http/session.ts";
import { router } from "./router.ts";

// Поток событий данных пока не читает: из ScopedDb нужен только scope (uid в контексте лога), запросов нет.
const signedIn: Session = { s: { scope: testScope() } as ScopedDb, role: "user" };

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

  it("events.stream с сессией пуст и завершается, когда процесс начинает остановку", async () => {
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
});
