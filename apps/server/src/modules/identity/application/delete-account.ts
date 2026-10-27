// «Удалить аккаунт» (PRIV-06, AUTH-12, SEC-02): подтверждение паролем, затем безвозвратное удаление всех данных
// пользователя. identity организует, данные удаляют их владельцы через реестр (privacy.purge). Порядок:
//   1) частота — на пользователя (как вход); пароль сверяется постоянным по времени сравнением;
//   2) транзакция: последнего администратора удалить нельзя (LAST_ADMIN, под блокировкой строк админов), иначе
//      пользователь блокируется и все его сессии завершаются — с этого момента ни сайт, ни задачи (ScopeVerifier
//      пропускает только активных) не пишут ему новых данных;
//   3) ожидающие задачи домохозяйства удаляются (запоздавшую отбросит ScopeVerifier);
//   4) privacy.purge: строки всех владельцев данных, каталог файлов, системные строки модулей, трассы Langfuse;
//   5) письма локального ящика на его адрес;
//   6) последней — запись identity: ссылки из писем, пользователь (сессии, пароль, код — каскадом), домохозяйство.
// Сбой между шагами оставляет пользователя заблокированным, а повтор (администратор, T-017) доводит удаление: каждый
// шаг идемпотентен. Ответ — Set-Cookie, снимающая cookie сессии.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import type { MailFacade } from "../../mail/index.ts";
import type { PrivacyFacade } from "../../privacy/index.ts";
import type { AuthGateway } from "../infrastructure/auth.ts";
import {
  deleteSessions,
  deleteUserRecords,
  passwordHashOf,
  updateUserAccess,
  userCard,
} from "../infrastructure/db/identity.repo.ts";
import { verifyPassword } from "../infrastructure/password.ts";
import { rateRuleOf, SIGN_IN } from "../settings.ts";
import type { AdminGuard } from "./admins.ts";

export interface DeleteAccountDeps {
  readonly platform: Pick<
    SystemPlatform,
    "system" | "clock" | "log" | "settings" | "rateLimiter" | "jobs"
  >;
  readonly auth: Pick<AuthGateway, "expiredSessionCookie">;
  readonly admins: Pick<AdminGuard, "assertRemovable">;
  readonly privacy: Pick<PrivacyFacade, "purge">;
  readonly mail: Pick<MailFacade, "forgetRecipient">;
}

export function makeDeleteAccount(d: DeleteAccountDeps) {
  const { platform } = d;
  return async function deleteAccount(s: ScopedDb, password: string): Promise<readonly string[]> {
    const { userId, householdId } = s.scope;
    await platform.rateLimiter.enforce(await rateRuleOf(platform.settings, SIGN_IN), userId);
    const card = await userCard(platform.system, userId);
    const hash = await passwordHashOf(platform.system, userId);
    if (card === undefined || hash === undefined || !(await verifyPassword({ hash, password }))) {
      throw new AppError("INVALID_CREDENTIALS");
    }
    await platform.system.transaction(async (tx) => {
      await d.admins.assertRemovable(tx, userId);
      await updateUserAccess(tx, userId, { status: "blocked" }, platform.clock.now());
      await deleteSessions(tx, userId);
    });
    const discarded = await platform.jobs.discardHousehold(householdId);
    await d.privacy.purge(s);
    await d.mail.forgetRecipient(card.email);
    await platform.system.transaction((tx) => deleteUserRecords(tx, { userId, householdId }));
    platform.log.info({ userId, count: discarded }, "identity.account-deleted");
    return [d.auth.expiredSessionCookie()];
  };
}
