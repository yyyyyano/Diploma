// NFR-21: поток events.stream → инвалидация TanStack Query; конец потока и ошибка → переподключение и перезапрос.
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/msw.ts";
import { createApiClient, orpc } from "./api.ts";
import { progressQueryKey, retryDelayMs, runEventStream } from "./events.ts";

const ORIGIN = "http://localhost:5173";
const STREAM = `${ORIGIN}/api/events/stream`;
const ID = "0b9c2d4e-6f70-4a81-92b3-c4d5e6f70812";

/** Тело SSE так, как его шлёт OpenAPIHandler oRPC: event message с JSON, конец — event done. */
function sse(...events: readonly { event: string; data?: unknown }[]): HttpResponse<string> {
  const text = events
    .map(({ event, data }) =>
      data === undefined
        ? `event: ${event}\n\n`
        : `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
  return new HttpResponse(text, { headers: { "content-type": "text/event-stream" } });
}

const unauthorized = () =>
  HttpResponse.json(
    {
      defined: true,
      code: "UNAUTHORIZED",
      status: 401,
      message: "UNAUTHORIZED",
      data: { requestId: "req-00000001", params: {} },
    },
    { status: 401 },
  );

/** Запросы с данными и признаком «устарели» — чтобы видеть инвалидацию по состоянию кэша. */
function cacheWithData(): QueryClient {
  const queryClient = new QueryClient();
  // Ключи — настоящие (orpc), данные — любые: важно только, какие запросы пометит инвалидация.
  const seed = (key: readonly unknown[]) => queryClient.setQueryData<unknown>([...key], []);
  seed(orpc.accounts.list.queryKey());
  seed(orpc.transactions.list.queryKey({ input: { page: 1 } }));
  seed(orpc.categories.list.queryKey());
  return queryClient;
}

const invalidated = (queryClient: QueryClient) =>
  queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.isInvalidated)
    .map((query) => (query.queryKey[0] as string[]).join("."));

/**
 * Поток, который отвечает по очереди заготовками; следующий запрос после них останавливает клиента (abort) —
 * так тест знает, что все ответы прочитаны до конца.
 */
function scripted(responses: readonly (() => Response)[], controller: AbortController) {
  let calls = 0;
  server.use(
    http.get(STREAM, () => {
      const respond = responses[calls];
      calls += 1;
      if (respond !== undefined) return respond();
      controller.abort();
      return unauthorized();
    }),
  );
  return { reconnects: () => calls - 1 };
}

const noWait = () => Promise.resolve();

describe("NFR-21: клиент events.stream", () => {
  it("changed по счёту — перезапрашиваются только запросы счетов, операции и категории не тронуты", async () => {
    const queryClient = cacheWithData();
    const controller = new AbortController();
    scripted(
      [() => sse({ event: "message", data: { type: "changed", entity: "account", id: ID } })],
      controller,
    );
    await runEventStream({
      client: createApiClient(() => ORIGIN),
      queryClient,
      signal: controller.signal,
      sleep: noWait,
    });
    expect(invalidated(queryClient)).toEqual(["accounts.list"]);
  });

  it("changed по операции — только запросы операций (привязка «сущность → запросы»)", async () => {
    const queryClient = cacheWithData();
    const controller = new AbortController();
    scripted(
      [() => sse({ event: "message", data: { type: "changed", entity: "transaction", id: ID } })],
      controller,
    );
    await runEventStream({
      client: createApiClient(() => ORIGIN),
      queryClient,
      signal: controller.signal,
      sleep: noWait,
    });
    expect(invalidated(queryClient)).toEqual(["transactions.list"]);
  });

  it("changed незнакомой сущности — безопасное умолчание: перезапрос всех запросов", async () => {
    const queryClient = cacheWithData();
    const controller = new AbortController();
    scripted(
      [() => sse({ event: "message", data: { type: "changed", entity: "receipt", id: ID } })],
      controller,
    );
    await runEventStream({
      client: createApiClient(() => ORIGIN),
      queryClient,
      signal: controller.signal,
      sleep: noWait,
    });
    expect(invalidated(queryClient)).toEqual([
      "accounts.list",
      "transactions.list",
      "categories.list",
    ]);
  });

  it("progress — ход работы в кэше под progressQueryKey, без перезапроса данных", async () => {
    const queryClient = cacheWithData();
    const controller = new AbortController();
    scripted(
      [
        () =>
          sse({
            event: "message",
            data: { type: "progress", entity: "receipt", id: ID, percent: 40 },
          }),
      ],
      controller,
    );
    await runEventStream({
      client: createApiClient(() => ORIGIN),
      queryClient,
      signal: controller.signal,
      sleep: noWait,
    });
    expect(queryClient.getQueryData(progressQueryKey("receipt", ID))).toEqual({ percent: 40 });
    expect(invalidated(queryClient)).toEqual([]);
  });

  it("конец потока (event: done) — переподключение и перезапрос всех запросов", async () => {
    const queryClient = cacheWithData();
    const controller = new AbortController();
    const stream = scripted(
      [() => sse({ event: "done", data: "reconnect" }), () => sse({ event: "done" })],
      controller,
    );
    await runEventStream({
      client: createApiClient(() => ORIGIN),
      queryClient,
      signal: controller.signal,
      sleep: noWait,
    });
    expect(stream.reconnects()).toBe(2);
    expect(invalidated(queryClient)).toEqual([
      "accounts.list",
      "transactions.list",
      "categories.list",
    ]);
  });

  it("ошибка сервера — переподключение после паузы и перезапрос", async () => {
    const queryClient = cacheWithData();
    const controller = new AbortController();
    const pauses: number[] = [];
    const stream = scripted(
      [() => new HttpResponse(null, { status: 503 }), () => sse({ event: "done" })],
      controller,
    );
    await runEventStream({
      client: createApiClient(() => ORIGIN),
      queryClient,
      signal: controller.signal,
      sleep: (ms) => {
        pauses.push(ms);
        return Promise.resolve();
      },
    });
    expect(stream.reconnects()).toBe(2);
    expect(pauses.slice(0, 2)).toEqual([1000, 2000]);
    expect(invalidated(queryClient)).toEqual([
      "accounts.list",
      "transactions.list",
      "categories.list",
    ]);
  });

  it("UNAUTHORIZED — сессии нет: поток не переподключается", async () => {
    const queryClient = cacheWithData();
    const controller = new AbortController();
    let calls = 0;
    server.use(
      http.get(STREAM, () => {
        calls += 1;
        return unauthorized();
      }),
    );
    await runEventStream({
      client: createApiClient(() => ORIGIN),
      queryClient,
      signal: controller.signal,
      sleep: noWait,
    });
    expect(calls).toBe(1);
    expect(invalidated(queryClient)).toEqual([]);
  });

  it("пауза растёт 1, 2, 4… с и не больше 30 с", () => {
    expect([1, 2, 3, 4, 6, 10].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, 30_000, 30_000]);
  });
});
