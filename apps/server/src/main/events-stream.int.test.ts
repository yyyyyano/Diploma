// events.stream целиком на настоящем Postgres и HTTP (NFR-21, ROLE-01, SEC-04, ADR-0008): realtime.changed →
// NOTIFY kosht_realtime → LISTEN → хаб → SSE на реальном порту 0. Поток читается fetch и разбирается как в
// браузере. Ожидание — промис (следующее событие потока), без sleep; «сигнала нет» доказывает барьер: после
// сигнала, которого быть не должно, идёт сигнал-«часовой» тому же потоку — пришёл часовой, а перед ним ничего,
// значит пропущенный сигнал уже был бы доставлен (NOTIFY одной сессии доставляются по порядку).
import type { Scope } from "@kosht/kernel";
import { readSse, testScope, type SseEvent } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appDbConfig, type AppDbConfig } from "../platform/db/__fixtures__/app-db-config.ts";
import { listenConnector } from "../platform/db/listen.ts";
import { createScopedDb } from "../platform/db/scoped-db.ts";
import { createApiHandler } from "../platform/http/api.ts";
import { createApp } from "../platform/http/app.ts";
import { createListeners, type Listeners } from "../platform/http/listeners.ts";
import { memoryLogger } from "../platform/logging/__fixtures__/memory-logger.ts";
import {
  createRealtime,
  createRealtimeStreams,
  type Realtime,
  type RealtimeStreams,
} from "../platform/realtime/realtime.ts";
import { createRouter } from "./router.ts";

const LISTEN_NAME = "kosht-test-api-listen";
const scopeA = testScope({ user: 1, household: 1 });
const scopeB = testScope({ user: 2, household: 2 });
const SCOPES: Record<string, Scope> = { a: scopeA, b: scopeB };

let db: TestDb;
let app: AppDbConfig;
let realtime: Realtime;
let live: RealtimeStreams;
let listeners: Listeners;
let base: string;

beforeAll(async () => {
  db = await createTestDb();
  app = appDbConfig(db);
  const log = memoryLogger().log;
  realtime = createRealtime({ pool: db.pool });
  live = createRealtimeStreams({ connect: listenConnector(app.config, LISTEN_NAME), log });
  await live.start();
  const handler = createApiHandler(createRouter({ streams: live.streams }), log);
  const shutdown = new AbortController();
  // Сессия теста — по заголовку x-test-user (источник сессий сайта появится с identity, T-009).
  const session = async (headers: Headers) => {
    const scope = SCOPES[headers.get("x-test-user") ?? ""];
    return scope === undefined
      ? undefined
      : { s: createScopedDb(db.pool, scope), role: "user" as const };
  };
  listeners = createListeners({
    local: { host: "127.0.0.1", port: 0 },
    lan: { host: "127.0.0.1", port: 0 },
    allowLan: async () => false,
    log,
    fetch: (listener) =>
      createApp({
        listener,
        trustedOrigins: [],
        log,
        ready: async () => {},
        api: { handler, session, shutdownSignal: shutdown.signal },
      }).fetch,
  });
  await listeners.start();
  base = `http://127.0.0.1:${String(listeners.address("local")?.port)}`;
});

afterAll(async () => {
  await live.stop();
  await listeners.stop(1_000);
  await db.drop();
  app.cleanup();
});

function uuid(n: number): string {
  return `0190f0a0-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
}

interface OpenStream {
  /** Следующее событие message или done (комментарии keepalive пропускаются). */
  next(): Promise<SseEvent>;
  /** Закрыть запрос и дождаться, пока сервер уберёт поток из хаба. */
  close(): Promise<void>;
  /**
   * Ответ держится ссылкой, пока жив поток: undici отменяет тело ответа, собранного сборщиком мусора, — непрочитанный
   * поток оборвался бы посреди теста.
   */
  readonly response: Response;
}

/** Сколько потоков теста сейчас должно быть в хабе. */
let expectedOpen = 0;

/** Открыть events.stream пользователем user и дождаться, пока поток встанет в хаб. */
async function openStream(user: "a" | "b"): Promise<OpenStream> {
  const request = new AbortController();
  const response = await fetch(`${base}/api/events/stream`, {
    headers: { "x-test-user": user, accept: "text/event-stream" },
    signal: request.signal,
  });
  expect(response.status).toBe(200);
  if (response.body === null) throw new Error("у ответа нет тела");
  const events = readSse(response.body);
  expectedOpen += 1;
  await vi.waitFor(() => expect(live.streams.size).toBe(expectedOpen));
  let closed = false;
  return {
    response,
    async next() {
      for (;;) {
        const { value, done } = await events.next();
        if (done) throw new Error("поток закончился без события done");
        if (value.comment !== true) return value;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      request.abort();
      expectedOpen -= 1;
      await vi.waitFor(() => expect(live.streams.size).toBe(expectedOpen));
    },
  };
}

function changedId(event: SseEvent): string {
  expect(event.event).toBe("message");
  const body = JSON.parse(event.data ?? "") as { type: string; id: string };
  expect(body.type).toBe("changed");
  return body.id;
}

describe("ROLE-01, SEC-04: поток домохозяйства A не получает сигналы B", () => {
  it("сигнал B, затем часовой A — первым и единственным в потоке A приходит часовой", async () => {
    const a = await openStream("a");
    const b = await openStream("b");
    try {
      await realtime.changed(createScopedDb(db.pool, scopeB), {
        entity: "receipt",
        ids: [uuid(1)],
      });
      await realtime.changed(createScopedDb(db.pool, scopeA), {
        entity: "receipt",
        ids: [uuid(2)],
      });
      expect(changedId(await a.next())).toBe(uuid(2));
      expect(changedId(await b.next())).toBe(uuid(1));
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("progress идёт сразу через пул и несёт долю", async () => {
    const a = await openStream("a");
    try {
      await realtime.progress(scopeA, { entity: "receipt", id: uuid(3), percent: 40 });
      const event = await a.next();
      expect(JSON.parse(event.data ?? "")).toEqual({
        type: "progress",
        entity: "receipt",
        id: uuid(3),
        percent: 40,
      });
    } finally {
      await a.close();
    }
  });
});

describe("NFR-21: сигналы доходят все", () => {
  it("300 вызовов changed по разным id — все 300 id в потоке", async () => {
    const a = await openStream("a");
    try {
      const s = createScopedDb(db.pool, scopeA);
      for (let n = 0; n < 300; n += 1) {
        await realtime.changed(s, { entity: "transaction", ids: [uuid(1000 + n)] });
      }
      const received = new Set<string>();
      while (received.size < 300) received.add(changedId(await a.next()));
      expect([...received].toSorted()).toEqual(
        Array.from({ length: 300 }, (_, n) => uuid(1000 + n)).toSorted(),
      );
    } finally {
      await a.close();
    }
  });

  it("пачка из 1000 id с сущностью из 48 символов режется на куски и доходит целиком", async () => {
    const a = await openStream("a");
    try {
      const ids = Array.from({ length: 1000 }, (_, n) => uuid(5000 + n));
      const entity = `a${"-b".repeat(23)}c`;
      await realtime.changed(createScopedDb(db.pool, scopeA), { entity, ids });
      const received: string[] = [];
      while (received.length < 1000) received.push(changedId(await a.next()));
      expect(received).toEqual(ids);
    } finally {
      await a.close();
    }
  });
});

describe("ADR-0008: сигнал в транзакции уходит при коммите", () => {
  it("откат и ROLLBACK TO SAVEPOINT — сигнала нет; коммит — есть", async () => {
    const a = await openStream("a");
    try {
      const s = createScopedDb(db.pool, scopeA);
      await expect(
        s.transaction(async (tx) => {
          await realtime.changed(tx, { entity: "receipt", ids: [uuid(10)] });
          throw new Error("откат");
        }),
      ).rejects.toThrow("откат");
      await s.transaction(async (tx) => {
        await expect(
          tx.transaction(async (inner) => {
            await realtime.changed(inner, { entity: "receipt", ids: [uuid(11)] });
            throw new Error("откат точки");
          }),
        ).rejects.toThrow("откат точки");
        await realtime.changed(tx, { entity: "receipt", ids: [uuid(12)] });
      });
      await realtime.changed(s, { entity: "receipt", ids: [uuid(13)] });
      expect(changedId(await a.next())).toBe(uuid(12));
      expect(changedId(await a.next())).toBe(uuid(13));
    } finally {
      await a.close();
    }
  });
});

describe("ADR-0008: потеря соединения LISTEN", () => {
  it("pg_terminate_backend закрывает потоки событием done, новый поток снова получает сигналы", async () => {
    const before = await openStream("a");
    await db.owner.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where application_name = $1 and datname = $2",
      [LISTEN_NAME, db.name],
    );
    expect(await before.next()).toEqual({ event: "done", data: '"reconnect"' });
    await before.close();

    const after = await openStream("a");
    try {
      await realtime.changed(createScopedDb(db.pool, scopeA), {
        entity: "receipt",
        ids: [uuid(20)],
      });
      expect(changedId(await after.next())).toBe(uuid(20));
    } finally {
      await after.close();
    }
  });
});

describe("ADR-0015: остановка приёма", () => {
  it("stop() закрывает потоки событием done и соединение LISTEN", async () => {
    const a = await openStream("a");
    await live.stop();
    expect(await a.next()).toEqual({ event: "done", data: '"stopped"' });
    await a.close();
    await vi.waitFor(async () => {
      const { rows } = await db.owner.query<{ n: number }>(
        "select count(*)::int as n from pg_stat_activity where application_name = $1 and datname = $2",
        [LISTEN_NAME, db.name],
      );
      expect(rows[0]?.n).toBe(0);
    });
  });
});
