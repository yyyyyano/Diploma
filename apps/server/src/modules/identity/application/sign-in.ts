// Вход и выход (AUTH-08, AUTH-11, SEC-02, ADR-0016): частота попыток — на email (порог — настройка
// identity.rate-sign-in), сверх — RATE_LIMITED «попробуйте через N мин.»; неверный email или пароль —
// INVALID_CREDENTIALS без уточнения, что именно неверно; заблокированный (пароль верный) — ACCOUNT_BLOCKED без cookie
// и карточки. Cookie kosht_session — строками Set-Cookie для ответа процедуры.
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { userCard } from "../infrastructure/db/identity.repo.ts";
import type { AuthGateway } from "../infrastructure/auth.ts";
import { rateRuleOf, SIGN_IN } from "../settings.ts";

export interface SignInDeps {
  readonly auth: AuthGateway;
  readonly platform: Pick<SystemPlatform, "system" | "log" | "settings" | "rateLimiter">;
}

export function makeSignIn(d: SignInDeps) {
  const { platform } = d;
  return async function signIn(credentials: { email: string; password: string }, headers: Headers) {
    const email = credentials.email.toLowerCase();
    await platform.rateLimiter.enforce(await rateRuleOf(platform.settings, SIGN_IN), email);
    const signed = await d.auth.signIn({ email, password: credentials.password }, headers);
    if (signed.kind === "invalid") throw new AppError("INVALID_CREDENTIALS");
    if (signed.kind === "blocked") {
      platform.log.info({ code: "ACCOUNT_BLOCKED" }, "identity.sign-in-blocked");
      throw new AppError("ACCOUNT_BLOCKED");
    }
    const user = await userCard(platform.system, signed.userId);
    if (user === undefined) throw new AppError("INVALID_CREDENTIALS");
    platform.log.info({ userId: signed.userId }, "identity.signed-in");
    return { user, cookies: signed.cookies };
  };
}

export function makeSignOut(d: { readonly auth: AuthGateway }) {
  return async function signOut(headers: Headers): Promise<readonly string[]> {
    return d.auth.signOut(headers);
  };
}
