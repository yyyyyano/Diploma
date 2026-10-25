// Сессия на сайте: охрана раздела по роли и выход с очисткой кэша (frontend-feature.md).
import { QueryClient } from "@tanstack/react-query";
import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw.ts";
import { createApiClient } from "./api.ts";
import {
  createApiSession,
  requireRole,
  requireUser,
  signOut,
  type SessionSource,
  type SessionUser,
} from "./session.ts";

const admin: SessionUser = { name: "Администратор", email: "admin@example.test", role: "admin" };

function sessionOf(user: SessionUser | undefined, signOutError?: Error): SessionSource {
  return {
    current: () => Promise.resolve(user),
    signOut: () => (signOutError ? Promise.reject(signOutError) : Promise.resolve()),
  };
}

describe("requireRole — раздел «Администрирование»", () => {
  it("администратор проходит и получает пользователя", async () => {
    await expect(requireRole(sessionOf(admin), "admin")).resolves.toEqual(admin);
  });

  it("обычный пользователь получает «нет такой страницы», а не «нет доступа»", async () => {
    const error: unknown = await requireRole(sessionOf({ ...admin, role: "user" }), "admin").catch(
      (e: unknown) => e,
    );
    expect(isNotFound(error)).toBe(true);
  });

  it("гость (сайт без входа) тоже не проходит", async () => {
    const error: unknown = await requireRole(sessionOf(undefined), "admin").catch(
      (e: unknown) => e,
    );
    expect(isNotFound(error)).toBe(true);
  });
});

describe("signOut — выход", () => {
  it("очищает кэш запросов: данные прежнего пользователя не видны следующему", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["accounts", "list"], [{ name: "Наличные" }]);
    await signOut(sessionOf(admin), queryClient);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("очищает кэш, даже если сервер не ответил, и сообщает об ошибке", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["accounts", "list"], []);
    await expect(signOut(sessionOf(admin, new Error("сеть")), queryClient)).rejects.toThrow("сеть");
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe("AUTH-08: сессия из процедур identity", () => {
  const api = createApiSession(createApiClient(() => "http://127.0.0.1:8140"));
  const unauthorized = {
    defined: true,
    code: "UNAUTHORIZED",
    status: 401,
    message: "UNAUTHORIZED",
    data: { requestId: "req-00000001", params: {} },
  };

  it("вошедший — email, роль; пустое имя заменяет email", async () => {
    server.use(
      http.get("*/api/identity/me", () =>
        HttpResponse.json({ email: "admin@example.test", name: "", role: "admin" }),
      ),
    );
    expect(await api.current()).toEqual({
      name: "admin@example.test",
      email: "admin@example.test",
      role: "admin",
    });
  });

  it("без сессии (UNAUTHORIZED) — гость, а не ошибка", async () => {
    server.use(
      http.get("*/api/identity/me", () => HttpResponse.json(unauthorized, { status: 401 })),
    );
    expect(await api.current()).toBeUndefined();
  });

  it("гость в разделе пользователя — переход на вход", async () => {
    const queryClient = new QueryClient();
    const error: unknown = await requireUser({ session: sessionOf(undefined), queryClient }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ options: { to: "/login" } });
  });

  it("вошедший проходит; кто вошёл — из кэша сессии, повторно сервер не спрашивается", async () => {
    const queryClient = new QueryClient();
    let calls = 0;
    const session: SessionSource = {
      current: () => {
        calls += 1;
        return Promise.resolve(admin);
      },
      signOut: () => Promise.resolve(),
    };
    await expect(requireUser({ session, queryClient })).resolves.toEqual(admin);
    await expect(requireUser({ session, queryClient })).resolves.toEqual(admin);
    expect(calls).toBe(1);
  });
});
