// Клиент процедур говорит с сервером по REST контракта: путь /api/<процедура>, ошибки — коды каталога.
import { QueryClient } from "@tanstack/react-query";
import { ORPCError } from "@orpc/client";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/msw.ts";
import { createApiClient } from "./api.ts";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

const ORIGIN = "http://localhost:5173";

describe("клиент oRPC по контракту", () => {
  it("system.health — GET /api/system/health", async () => {
    server.use(http.get(`${ORIGIN}/api/system/health`, () => HttpResponse.json({ status: "ok" })));
    await expect(createApiClient(() => ORIGIN).system.health()).resolves.toEqual({ status: "ok" });
  });

  it("queryOptions для TanStack Query берут данные той же процедурой", async () => {
    server.use(http.get(`${ORIGIN}/api/system/health`, () => HttpResponse.json({ status: "ok" })));
    const orpc = createTanstackQueryUtils(createApiClient(() => ORIGIN));
    const data = await new QueryClient().fetchQuery(orpc.system.health.queryOptions());
    expect(data).toEqual({ status: "ok" });
  });

  it("ошибка сервера приходит кодом каталога, а не текстом", async () => {
    server.use(
      http.get(`${ORIGIN}/api/events/stream`, () =>
        HttpResponse.json(
          {
            defined: true,
            code: "UNAUTHORIZED",
            status: 401,
            message: "UNAUTHORIZED",
            data: { requestId: "req-00000001", params: {} },
          },
          { status: 401 },
        ),
      ),
    );
    const error: unknown = await createApiClient(() => ORIGIN)
      .events.stream()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });
});
