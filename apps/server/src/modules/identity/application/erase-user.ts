// Безвозвратное удаление пользователя (PRIV-06, AUTH-12): общий путь «Удалить аккаунт» (сам, с паролем) и удаления
// администратором (ADM-30). identity организует, данные удаляют их владельцы через реестр (privacy.purge). Порядок:
//   1) транзакция: последнего администратора удалить нельзя (LAST_ADMIN, под блокировкой строк админов), иначе
//      пользователь блокируется и все его сессии завершаются — с этого момента ни сайт, ни задачи (ScopeVerifier
//      пропускает только активных) не пишут ему новых данных;
//   2) ожидающие задачи домохозяйства удаляются (запоздавшую отбросит ScopeVerifier);
//   3) privacy.purge под scope удаляемого: строки всех владельцев данных, каталог файлов, системные строки модулей,
//      трассы Langfuse;
//   4) письма локального ящика на его адрес;
//   5) последней — запись identity: ссылки из писем, пользователь (сессии, пароль, код — каскадом), домохозяйство.
// Сбой между шагами оставляет пользователя заблокированным, а повтор доводит удаление: каждый шаг идемпотентен.
import type { Scope } from "@kosht/kernel";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import type { MailFacade } from "../../mail/index.ts";
import type { PrivacyFacade } from "../../privacy/index.ts";
import {
  deleteSessions,
  deleteUserRecords,
  updateUserAccess,
} from "../infrastructure/db/identity.repo.ts";
import type { AdminGuard } from "./admins.ts";

export interface EraseUserDeps {
  readonly platform: Pick<SystemPlatform, "system" | "clock" | "log" | "jobs" | "scoped">;
  readonly admins: Pick<AdminGuard, "assertRemovable">;
  readonly privacy: Pick<PrivacyFacade, "purge">;
  readonly mail: Pick<MailFacade, "forgetRecipient">;
}

export function makeEraseUser(d: EraseUserDeps) {
  const { platform } = d;
  /** Удалить пользователя scope со всеми данными; email — его адрес (письма локального ящика). */
  return async function eraseUser(scope: Scope, email: string): Promise<void> {
    const { userId, householdId } = scope;
    await platform.system.transaction(async (tx) => {
      await d.admins.assertRemovable(tx, userId);
      await updateUserAccess(tx, userId, { status: "blocked" }, platform.clock.now());
      await deleteSessions(tx, userId);
    });
    const discarded = await platform.jobs.discardHousehold(householdId);
    await d.privacy.purge(platform.scoped(scope));
    await d.mail.forgetRecipient(email);
    await platform.system.transaction((tx) => deleteUserRecords(tx, { userId, householdId }));
    platform.log.info({ userId, count: discarded }, "identity.account-deleted");
  };
}

export type EraseUser = ReturnType<typeof makeEraseUser>;
