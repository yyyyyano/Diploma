import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.ts";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import { createApp, type AppOptions, type HttpApp } from "./app.ts";
import { SECURITY_HEADERS, type ListenerName } from "./guard.ts";

const LOCAL = "http://127.0.0.1:8140";

function app(overrides: Partial<AppOptions> = {}) {
  const memory = memoryLogger();
  const options: AppOptions = {
    listener: "local",
    trustedOrigins: [],
    log: memory.log,
    ready: async () => {},
    ...overrides,
  };
  return { app: createApp(options), memory };
}

function call(target: HttpApp, path: string, init: RequestInit = {}, host = "127.0.0.1:8140") {
  const headers = new Headers(init.headers);
  if (!headers.has("host")) headers.set("host", host);
  return target.fetch(new Request(`${LOCAL}${path}`, { ...init, headers }));
}

async function errorOf(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("SEC-01: заголовки безопасности — точными строками на каждом ответе", () => {
  it("CSP, nosniff, Referrer-Policy, Permissions-Policy — как в задаче", async () => {
    const response = await call(app().app, "/healthz");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; " +
        "form-action 'self'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("permissions-policy")).toBe("camera=(self), microphone=(self)");
  });

  it("HSTS и upgrade-insecure-requests нет: сайт работает по HTTP", async () => {
    const response = await call(app().app, "/healthz");
    expect(response.headers.get("strict-transport-security")).toBeNull();
    expect(response.headers.get("content-security-policy")).not.toContain("upgrade-insecure");
  });

  it.each([
    ["отказ Host", "/healthz", {}, "evil.example:8140"],
    ["неизвестный маршрут", "/nope", { method: "POST" }, "127.0.0.1:8140"],
    ["ошибка обработчика", "/boom", {}, "127.0.0.1:8140"],
  ] as const)("заголовки стоят и на ответе «%s»", async (_, path, init, host) => {
    const target = app({
      routes: (a) => {
        a.get("/boom", () => {
          throw new Error("сбой");
        });
      },
    }).app;
    const response = await call(target, path, init, host);
    expect(response.status).toBeGreaterThanOrEqual(400);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it("CORS нет: ни одного Access-Control-* даже на OPTIONS с Origin", async () => {
    const response = await call(app().app, "/api/system/health", {
      method: "OPTIONS",
      headers: {
        origin: "http://evil.example",
        "access-control-request-method": "POST",
      },
    });
    const cors = [...response.headers.keys()].filter((name) => name.startsWith("access-control-"));
    expect(cors).toEqual([]);
  });
});

describe("NFR-24: Host и CSRF на входе", () => {
  it("чужое имя в Host → 403 FORBIDDEN в общем формате ошибки", async () => {
    const response = await call(app().app, "/healthz", {}, "evil.example:8140");
    expect(response.status).toBe(403);
    const body = await errorOf(response);
    expect(body).toEqual({
      defined: false,
      code: "FORBIDDEN",
      status: 403,
      message: "FORBIDDEN",
      data: { requestId: response.headers.get("x-request-id"), params: {} },
    });
  });

  it.each<[ListenerName, string, number]>([
    ["local", "192.168.1.5:8141", 403],
    ["lan", "192.168.1.5:8141", 200],
    ["lan", "kosht.home:8141", 403],
  ])("слушатель %s, Host %s → %i", async (listener, host, status) => {
    const response = await call(app({ listener }).app, "/healthz", {}, host);
    expect(response.status).toBe(status);
  });

  it("изменяющий запрос с чужой страницы (Sec-Fetch-Site: cross-site) → 403", async () => {
    const response = await call(app().app, "/nope", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site", origin: "http://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("изменяющий запрос с Origin из TRUSTED_ORIGINS проходит охрану (дальше — 404 маршрута)", async () => {
    const response = await call(app({ trustedOrigins: ["http://tablet.home"] }).app, "/nope", {
      method: "POST",
      headers: { origin: "http://tablet.home" },
    });
    expect(response.status).toBe(404);
  });

  it("X-Forwarded-Host и X-Forwarded-For не делают чужой Host своим", async () => {
    const response = await call(
      app().app,
      "/healthz",
      { headers: { "x-forwarded-host": "localhost:8140", "x-forwarded-for": "127.0.0.1" } },
      "evil.example:8140",
    );
    expect(response.status).toBe(403);
  });
});

describe("OBS-01: request-id и строка лога на каждый запрос", () => {
  it("id клиента по шаблону возвращается в ответе и попадает в лог", async () => {
    const { app: target, memory } = app();
    const response = await call(target, "/healthz", {
      headers: { "x-request-id": "client-req-0001" },
    });
    expect(response.headers.get("x-request-id")).toBe("client-req-0001");
    expect(memory.lines()).toContainEqual(
      expect.objectContaining({
        msg: "http.request",
        requestId: "client-req-0001",
        source: "http",
        method: "GET",
        httpStatus: 200,
        listener: "local",
      }),
    );
  });

  it("id не по шаблону заменяется новым, и он же — в ответе", async () => {
    const response = await call(app().app, "/healthz", { headers: { "x-request-id": "<script>" } });
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("/healthz и /readyz", () => {
  it("/healthz отвечает 200 и без БД", async () => {
    const response = await call(
      app({
        ready: async () => {
          throw new Error("БД недоступна");
        },
      }).app,
      "/healthz",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("/readyz — 200 { status: ok }, когда БД отвечает", async () => {
    const response = await call(app().app, "/readyz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("/readyz при недоступной БД — 503 UNAVAILABLE без деталей", async () => {
    const response = await call(
      app({
        ready: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:5440 kosht@db");
        },
      }).app,
      "/readyz",
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ code: "UNAVAILABLE", data: { params: {} } });
    expect(text).not.toContain("ECONNREFUSED");
  });
});

describe("OBS-02: ошибки обработчика", () => {
  it("исключение → 500 INTERNAL без текста; стек и код — в строке http.error", async () => {
    const { app: target, memory } = app({
      routes: (a) => {
        a.get("/boom", () => {
          throw new Error("сломалось у ivan@mail.by");
        });
      },
    });
    const response = await call(target, "/boom");
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject({ code: "INTERNAL", message: "INTERNAL" });
    expect(text).not.toContain("ivan@mail.by");
    expect(text).not.toContain("сломалось");
    const line = memory.lines().find((entry) => entry["msg"] === "http.error");
    expect(line).toMatchObject({ code: "INTERNAL", err: { type: "Error" } });
    const err = line?.["err"] as { stack?: string[] } | undefined;
    expect(err?.stack?.length).toBeGreaterThan(0);
    expect(memory.text()).not.toContain("ivan@mail.by");
  });

  it("AppError обработчика → свой код без строки http.error", async () => {
    const { app: target, memory } = app({
      routes: (a) => {
        a.get("/conflict", () => {
          throw new AppError("CONFLICT");
        });
      },
    });
    const response = await call(target, "/conflict");
    expect(response.status).toBe(409);
    expect(memory.lines().some((entry) => entry["msg"] === "http.error")).toBe(false);
  });
});
