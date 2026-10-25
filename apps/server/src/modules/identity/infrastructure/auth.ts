// Better Auth — только ядро (ADR-0016): вход по email и паролю и сессии, без плагинов. HTTP-обработчик Better Auth
// (auth.handler) не монтируется: вход, выход и сессию зовут процедуры oRPC через auth.api.* (api/router.ts), поэтому
// регистрации по HTTP нет вовсе (disableSignUp — вторая защита), а CSRF, Host и частоту проверяет платформа.
// Таблицы — systemTable identity под своими именами (modelName); адаптер Drizzle работает на SystemDb — каждый его
// запрос проходит аудитор SQL, $client ему не нужен. Свои надстройки:
// - пароль — argon2id из node:crypto (password.ts), длина ≥ 12 (SEC-01);
// - cookie kosht_session (HttpOnly, SameSite=Lax, без Secure: сайт идёт по http на localhost и в LAN), cookieCache
//   выключен — блокировка и выход действуют сразу (AUTH-11);
// - householdId — поле сессии: копируется из пользователя при входе, сессия сайта даёт scope без запроса за ним;
// - ip сессии не хранится (лишние ПД), телеметрия и лимиты Better Auth выключены (лимиты — platform/rate-limit).
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { householdOf } from "./db/identity.repo.ts";
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
          // AUTH-11 и ROLE-01: сессия получает домохозяйство пользователя; пользователя нет — сессии нет.
          before: async (session) => {
            const householdId = await householdOf(deps.system, session.userId);
            if (householdId === undefined) return false;
            return { data: { ...session, householdId } };
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
