// Сессия на сайте (ARCHITECTURE §10.1, ADR-0016): кто вошёл и выход. Источник подставляет app через контекст
// роутера — сами процедуры входа и сессии появляются с модулем identity (T-009); до него сайт знает только гостя.
import type { QueryClient } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";

export type Role = "user" | "admin";

export interface SessionUser {
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

/** Сайт без модуля identity: входа ещё нет, каждый посетитель — гость. */
export const guestSession: SessionSource = {
  current: () => Promise.resolve(undefined),
  signOut: () => Promise.resolve(),
};

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
