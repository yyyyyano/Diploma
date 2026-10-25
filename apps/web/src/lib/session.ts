// Сессия на сайте (ARCHITECTURE §10.1, ADR-0016): кто вошёл, вход в разделы и выход. Источник — процедуры identity
// (cookie kosht_session ставит и снимает сервер; сайт её не читает — HttpOnly). Кто вошёл, держит кэш TanStack
// Query под SESSION_QUERY_KEY: каркас и охрана маршрутов спрашивают сервер один раз, а выход и вход чистят кэш.
import type { QueryClient } from "@tanstack/react-query";
import { notFound, redirect } from "@tanstack/react-router";
import { ORPCError } from "@orpc/client";
import type { ApiClient } from "./api.ts";

export type Role = "user" | "admin";

export interface SessionUser {
  /** Имя для бокового меню; пустое имя заменяет email. */
  readonly name: string;
  readonly email: string;
  readonly role: Role;
}

export interface SessionSource {
  /** Пользователь текущей сессии; нет сессии — undefined. */
  current(): Promise<SessionUser | undefined>;
  /** Завершить сессию на сервере. */
  signOut(): Promise<void>;
}

/** Сессия через процедуры identity: me (без сессии — UNAUTHORIZED → гость) и signOut. */
export function createApiSession(client: ApiClient): SessionSource {
  return {
    async current() {
      try {
        const user = await client.identity.me();
        return {
          name: user.name === "" ? user.email : user.name,
          email: user.email,
          role: user.role,
        };
      } catch (error) {
        // Гость — штатный ответ, а не сбой; остальные ошибки (сервер недоступен) — наружу, в границу ошибок.
        if (error instanceof ORPCError && error.code === "UNAUTHORIZED") return undefined;
        throw error;
      }
    },
    async signOut() {
      await client.identity.signOut();
    },
  };
}

/** Ключ кэша пользователя сессии: выход и вход чистят кэш целиком — и его тоже. */
export const SESSION_QUERY_KEY = ["session", "current"] as const;

/** Запрос «кто вошёл» для TanStack Query (useQuery не хранит undefined: гость — null). */
export function sessionQuery(session: SessionSource) {
  return {
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => (await session.current()) ?? null,
  };
}

/** Кто вошёл — из кэша или с сервера (охрана маршрутов в beforeLoad). */
export async function currentUser(context: {
  readonly session: SessionSource;
  readonly queryClient: QueryClient;
}): Promise<SessionUser | undefined> {
  return (await context.queryClient.ensureQueryData(sessionQuery(context.session))) ?? undefined;
}

/** Раздел пользователя: без сессии — на вход (AUTH-08). */
export async function requireUser(context: {
  readonly session: SessionSource;
  readonly queryClient: QueryClient;
}): Promise<SessionUser> {
  const user = await currentUser(context);
  if (user === undefined) throw redirect({ to: "/login" });
  return user;
}

/**
 * Охрана раздела по роли для beforeLoad (раздел «Администрирование»): не та роль или гость — «нет такой страницы».
 * Не «нет доступа»: так из интерфейса не узнать, что раздел есть (сервер всё равно проверяет роль сам — admin).
 */
export async function requireRole(session: SessionSource, role: Role): Promise<SessionUser> {
  const user = await session.current();
  if (user?.role !== role) throw notFound();
  return user;
}

/**
 * Выход: сессия на сервере завершена, кэш запросов очищен целиком — данные прежнего пользователя не должны
 * мелькнуть следующему (frontend-feature.md). Кэш чистится, даже если сервер не ответил.
 */
export async function signOut(session: SessionSource, queryClient: QueryClient): Promise<void> {
  try {
    await session.signOut();
  } finally {
    queryClient.clear();
  }
}
