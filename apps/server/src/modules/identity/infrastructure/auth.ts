// Better Auth — только ядро (ADR-0016): вход по email и паролю и сессии, без плагинов. HTTP-обработчик Better Auth
// (auth.handler) не монтируется: вход, выход и сессию зовут процедуры oRPC через auth.api.* (api/router.ts), поэтому
// регистрации по HTTP нет вовсе (disableSignUp — вторая защита), а CSRF, Host и частоту проверяет платформа.
// Таблицы — systemTable identity под своими именами (modelName); адаптер Drizzle работает на SystemDb — каждый его
// запрос проходит аудитор SQL, $client ему не нужен. Свои надстройки:
// - пароль — argon2id из node:crypto (password.ts), длина ≥ 12 (SEC-01);
// - cookie kosht_session (HttpOnly, SameSite=Lax, без Secure: сайт идёт по http на localhost и в LAN), cookieCache
//   выключен — блокировка и выход действуют сразу (AUTH-11); заблокированному сессия не создаётся (ACCOUNT_BLOCKED —
//   только после верного пароля: по одному email не узнать, заблокирован ли он); продление сессии в БД отдаёт и новую
//   cookie (getSession с returnHeaders) — платформа кладёт её в ответ процедуры;
// - householdId — поле сессии: копируется из пользователя при входе, сессия сайта даёт scope без запроса за ним;
// - ip сессии не хранится (лишние ПД), телеметрия и лимиты Better Auth выключены (лимиты — platform/rate-limit).
import { HouseholdId, UserId } from "@kosht/kernel";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { sessionOwner, type UserRole } from "./db/identity.repo.ts";
import {
  identityCredentials,
  identitySessions,
  identityUsers,
  identityVerifications,
} from "./db/schema.ts";
import { hashPassword, verifyPassword } from "./password.ts";

/** Имя cookie сессии: своё — cookie не различают порты localhost (security-privacy.md). */
export const SESSION_COOKIE = "kosht_session";

/** Длина пароля (SEC-01, AUTH-10): не меньше 12 символов; верхняя граница — защита argon2 от огромного ввода. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export interface AuthDeps {
  readonly system: SystemDb;
  /** Ключ подписи cookie (HMAC): выводится из мастер-ключа, в логи и ответы не попадает. */
  readonly secret: string;
  /** Адрес локального входа: Better Auth строит по нему ссылки (подтверждение почты — T-012). */
  readonly baseURL: string;
}

export function createAuth(deps: AuthDeps) {
  return betterAuth({
    appName: "Kosht",
    baseURL: deps.baseURL,
    secret: deps.secret,
    database: drizzleAdapter(deps.system, {
      provider: "pg",
      schema: {
        identity_users: identityUsers,
        identity_sessions: identitySessions,
        identity_credentials: identityCredentials,
        identity_verifications: identityVerifications,
      },
    }),
    user: {
      modelName: "identity_users",
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "user", input: false },
        status: { type: "string", required: false, defaultValue: "active", input: false },
        demo: { type: "boolean", required: false, defaultValue: false, input: false },
        householdId: { type: "string", required: true, input: false },
      },
    },
    session: {
      modelName: "identity_sessions",
      cookieCache: { enabled: false },
      additionalFields: {
        householdId: { type: "string", required: true, input: false },
      },
    },
    account: { modelName: "identity_credentials" },
    verification: { modelName: "identity_verifications" },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    databaseHooks: {
      session: {
        create: {
          // AUTH-11 и ROLE-01: сессия получает домохозяйство пользователя; пользователя нет — сессии нет;
          // заблокирован — отказ ACCOUNT_BLOCKED (хук зовётся после проверки пароля).
          before: async (session) => {
            const owner = await sessionOwner(deps.system, session.userId);
            if (owner === undefined) return false;
            if (owner.status !== "active") {
              throw new APIError("FORBIDDEN", { code: BLOCKED, message: BLOCKED });
            }
            return { data: { ...session, householdId: owner.householdId } };
          },
        },
      },
    },
    advanced: {
      cookiePrefix: "kosht",
      useSecureCookies: false,
      cookies: { session_token: { name: SESSION_COOKIE } },
      database: { generateId: false },
      ipAddress: { disableIpTracking: true },
    },
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Код отказа хука сессии для заблокированного пользователя. */
const BLOCKED = "ACCOUNT_BLOCKED";

/** Кто вошёл — по сессии Better Auth (только активный пользователь, AUTH-11). */
export interface AuthSession {
  readonly userId: UserId;
  readonly householdId: HouseholdId;
  readonly role: UserRole;
  /** Set-Cookie продлённой сессии (раз в сутки); иначе пусто. */
  readonly cookies: readonly string[];
}

/** Итог входа: вошёл (cookie), неверный email или пароль, заблокирован (пароль верный). */
export type SignInResult =
  | { readonly kind: "ok"; readonly userId: UserId; readonly cookies: readonly string[] }
  | { readonly kind: "invalid" }
  | { readonly kind: "blocked" };

/**
 * Узкий порт над Better Auth для сценариев identity: application не видит better-auth (правило границ). Cookie —
 * готовыми строками Set-Cookie: процедура кладёт их в ответ как есть.
 */
export interface AuthGateway {
  /** Вход по email и паролю. */
  signIn(
    credentials: { readonly email: string; readonly password: string },
    headers: Headers,
  ): Promise<SignInResult>;
  /**
   * Смена пароля вошедшим (AUTH-08): текущий пароль неверен — undefined; иначе прочие сессии завершены, текущая
   * заменена новой — её Set-Cookie.
   */
  changePassword(
    passwords: { readonly currentPassword: string; readonly newPassword: string },
    headers: Headers,
  ): Promise<readonly string[] | undefined>;
  /** Выход: сессия из cookie запроса удаляется; cookie снимается (Set-Cookie). */
  signOut(headers: Headers): Promise<readonly string[]>;
  /** Сессия запроса; нет, истекла или пользователь не активен — undefined. */
  session(headers: Headers): Promise<AuthSession | undefined>;
}

export function createAuthGateway(auth: Auth): AuthGateway {
  return {
    async signIn(credentials, headers) {
      try {
        const { headers: out, response } = await auth.api.signInEmail({
          body: credentials,
          headers,
          returnHeaders: true,
        });
        return { kind: "ok", userId: UserId.parse(response.user.id), cookies: out.getSetCookie() };
      } catch (error) {
        // Неверный email или пароль (401) и блокировка из хука сессии — штатные ответы, а не сбой; остальное — наружу.
        if (error instanceof APIError && error.statusCode === 401) return { kind: "invalid" };
        if (error instanceof APIError && error.body?.code === BLOCKED) return { kind: "blocked" };
        throw error;
      }
    },
    async changePassword(passwords, headers) {
      try {
        const { headers: out } = await auth.api.changePassword({
          body: { ...passwords, revokeOtherSessions: true },
          headers,
          returnHeaders: true,
        });
        return out.getSetCookie();
      } catch (error) {
        if (error instanceof APIError && error.statusCode === 400) return undefined;
        // Сессии в cookie запроса нет (истекла между проверкой и вызовом) — как у любой процедуры без входа.
        if (error instanceof APIError && error.statusCode === 401)
          throw new AppError("UNAUTHORIZED");
        throw error;
      }
    },
    async signOut(headers) {
      const { headers: out } = await auth.api.signOut({ headers, returnHeaders: true });
      return out.getSetCookie();
    },
    async session(headers) {
      const { headers: out, response: found } = await auth.api.getSession({
        headers,
        returnHeaders: true,
      });
      if (found === null || found.user.status !== "active") return undefined;
      return {
        userId: UserId.parse(found.user.id),
        householdId: HouseholdId.parse(found.session.householdId),
        role: found.user.role === "admin" ? "admin" : "user",
        cookies: out.getSetCookie(),
      };
    },
  };
}
