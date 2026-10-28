// «Удалить аккаунт» (PRIV-06, AUTH-12, SEC-02): подтверждение паролем, затем безвозвратное удаление всех данных
// пользователя общим путём eraseUser (erase-user.ts). Частота — на пользователя (как вход); пароль сверяется
// постоянным по времени сравнением. Ответ — Set-Cookie, снимающая cookie сессии.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import type { AuthGateway } from "../infrastructure/auth.ts";
import { passwordHashOf, userCard } from "../infrastructure/db/identity.repo.ts";
import { verifyPassword } from "../infrastructure/password.ts";
import { rateRuleOf, SIGN_IN } from "../settings.ts";
import type { EraseUser } from "./erase-user.ts";

export interface DeleteAccountDeps {
  readonly platform: Pick<SystemPlatform, "system" | "settings" | "rateLimiter">;
  readonly auth: Pick<AuthGateway, "expiredSessionCookie">;
  readonly eraseUser: EraseUser;
}

export function makeDeleteAccount(d: DeleteAccountDeps) {
  const { platform } = d;
  return async function deleteAccount(s: ScopedDb, password: string): Promise<readonly string[]> {
    const { userId } = s.scope;
    await platform.rateLimiter.enforce(await rateRuleOf(platform.settings, SIGN_IN), userId);
    const card = await userCard(platform.system, userId);
    const hash = await passwordHashOf(platform.system, userId);
    if (card === undefined || hash === undefined || !(await verifyPassword({ hash, password }))) {
      throw new AppError("INVALID_CREDENTIALS");
    }
    await d.eraseUser(s.scope, card.email);
    return [d.auth.expiredSessionCookie()];
  };
}
