// Смена пароля в настройках (AUTH-08, SEC-01, SEC-02): частота — на пользователя (порог входа); текущий пароль неверен
// — INVALID_CREDENTIALS; иначе прочие сессии завершены, текущая заменена новой (Set-Cookie).
import { AppError } from "../../../platform/errors/app-error.ts";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import type { AuthGateway } from "../infrastructure/auth.ts";
import { rateRuleOf, SIGN_IN } from "../settings.ts";

export function makeChangePassword(d: {
  readonly auth: AuthGateway;
  readonly platform: Pick<SystemPlatform, "settings" | "rateLimiter" | "log">;
}) {
  return async function changePassword(
    s: ScopedDb,
    passwords: { readonly currentPassword: string; readonly newPassword: string },
    headers: Headers,
  ): Promise<readonly string[]> {
    const { platform } = d;
    await platform.rateLimiter.enforce(
      await rateRuleOf(platform.settings, SIGN_IN),
      s.scope.userId,
    );
    const cookies = await d.auth.changePassword(passwords, headers);
    if (cookies === undefined) throw new AppError("INVALID_CREDENTIALS");
    platform.log.info({ userId: s.scope.userId }, "identity.password-changed");
    return cookies;
  };
}
