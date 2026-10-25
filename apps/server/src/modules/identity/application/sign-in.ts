// Вход и выход (AUTH-08, ADR-0016): сессия Better Auth, cookie kosht_session — строками Set-Cookie для ответа
// процедуры. Неверный email или пароль — INVALID_CREDENTIALS без уточнения, что именно неверно. Частота попыток
// входа (SEC-02) — T-013.
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { userCard } from "../infrastructure/db/identity.repo.ts";
import type { AuthGateway } from "../infrastructure/auth.ts";

export interface SignInDeps {
  readonly auth: AuthGateway;
  readonly platform: Pick<SystemPlatform, "system" | "log">;
}

export function makeSignIn(d: SignInDeps) {
  return async function signIn(credentials: { email: string; password: string }, headers: Headers) {
    const signed = await d.auth.signIn(
      { email: credentials.email.toLowerCase(), password: credentials.password },
      headers,
    );
    if (signed === undefined) throw new AppError("INVALID_CREDENTIALS");
    const user = await userCard(d.platform.system, signed.userId);
    if (user === undefined) throw new AppError("INVALID_CREDENTIALS");
    d.platform.log.info({ userId: signed.userId }, "identity.signed-in");
    return { user, cookies: signed.cookies };
  };
}

export function makeSignOut(d: { readonly auth: AuthGateway }) {
  return async function signOut(headers: Headers): Promise<readonly string[]> {
    return d.auth.signOut(headers);
  };
}
