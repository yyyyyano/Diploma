// Сессия на сайте: охрана раздела по роли и выход с очисткой кэша (frontend-feature.md).
import { QueryClient } from "@tanstack/react-query";
import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import {
  guestSession,
  requireRole,
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
    const error: unknown = await requireRole(guestSession, "admin").catch((e: unknown) => e);
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
