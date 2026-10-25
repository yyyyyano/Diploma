// Сессия запроса сайта (ROLE-01, SEC-04, ARCHITECTURE §6.4): единственное место, где для запроса сайта рождается
// Scope. Кто пользователь — решает источник сессий, который регистрирует модуль входа (Better Auth в identity,
// T-009): resolver(headers) → { userId, householdId, role } или undefined. «Чьи данные» берутся только из сессии,
// никогда из тела запроса. Пока источник не зарегистрирован, сессии нет ни у кого: authed отвечает UNAUTHORIZED.
import { makeScope, type HouseholdId, type UserId } from "@kosht/kernel";
import { createScopedDb, type ScopedDb } from "../db/scoped-db.ts";

/** Роль пользователя: admin видит админку (без финансов, PRIV-07). */
export type SessionRole = "user" | "admin";

/** Кто вошёл — из сессии (без отдельного запроса на каждый вызов — решение пользователя, ARCHITECTURE §6.4). */
export interface SessionIdentity {
  readonly userId: UserId;
  readonly householdId: HouseholdId;
  readonly role: SessionRole;
}

/** Источник сессий: по заголовкам запроса (cookie kosht_session) — кто вошёл, или undefined. */
export type SessionResolver = (headers: Headers) => Promise<SessionIdentity | undefined>;

export interface SessionRegistry {
  /** Подключить источник сессий; он один на процесс — второй вызов — ошибка при старте. */
  register(resolver: SessionResolver): void;
  /** Кто вошёл; источника нет — undefined. */
  resolve(headers: Headers): Promise<SessionIdentity | undefined>;
}

export function createSessionRegistry(): SessionRegistry {
  let source: SessionResolver | undefined;
  return {
    register(resolver) {
      if (source !== undefined) throw new Error("Источник сессий уже зарегистрирован.");
      source = resolver;
    },
    async resolve(headers) {
      return source === undefined ? undefined : source(headers);
    },
  };
}

/** Сессия процедуры: данные домохозяйства — только через s (ScopedDb с аудитором). */
export interface Session {
  readonly s: ScopedDb;
  readonly role: SessionRole;
}

/** Пул БД (тот же тип, что принимает createScopedDb: pg напрямую сюда не импортируется). */
export type ScopedDbClient = Parameters<typeof createScopedDb>[0];

/** Сессия запроса: источник сессий → makeScope → ScopedDb; не вошёл — undefined. */
export async function openSession(
  registry: SessionRegistry,
  client: ScopedDbClient,
  headers: Headers,
): Promise<Session | undefined> {
  const identity = await registry.resolve(headers);
  if (identity === undefined) return undefined;
  const scope = makeScope({ userId: identity.userId, householdId: identity.householdId });
  return { s: createScopedDb(client, scope), role: identity.role };
}
