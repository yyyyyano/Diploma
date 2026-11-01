// «Пользователи» админки (ADM-30, PRIV-07): учётные записи — из identity (email, регистрация, подтверждение, статус,
// роль), режим ИИ — флаг из privacy, Telegram — флаг «подключён» из модуля бота (T-052). Ни финансов, ни профиля, ни счётчиков данных.
// Действия — фасады identity: там же защита последнего администратора (AUTH-12) и путь удаления (PRIV-06).
import type { Scope } from "@kosht/kernel";
import type { IdentityFacade } from "../../identity/index.ts";
import type { PrivacyFacade } from "../../privacy/index.ts";
import type { TelegramFacade } from "../../telegram/index.ts";

export interface AdminUserView {
  readonly id: string;
  readonly email: string;
  readonly registeredAt: Date;
  readonly emailVerified: boolean;
  readonly status: "active" | "blocked";
  readonly role: "user" | "admin";
  readonly demo: boolean;
  readonly telegram: boolean;
  readonly cloud: boolean;
  readonly self: boolean;
}

export function makeAdminUsers(d: {
  readonly identity: Pick<IdentityFacade, "listAccounts">;
  readonly privacy: Pick<PrivacyFacade, "cloudUsers">;
  readonly telegram: Pick<TelegramFacade["admin"], "linkedUsers">;
}) {
  /** Список для администратора actor: «вы» — его строка. */
  return async function users(actor: Scope): Promise<AdminUserView[]> {
    const [accounts, cloud, telegram] = await Promise.all([
      d.identity.listAccounts(),
      d.privacy.cloudUsers(),
      d.telegram.linkedUsers(),
    ]);
    return accounts.map((account) => ({
      ...account,
      telegram: telegram.has(account.id),
      cloud: cloud.has(account.id),
      self: account.id === actor.userId,
    }));
  };
}
