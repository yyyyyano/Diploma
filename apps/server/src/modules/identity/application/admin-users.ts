// Пользователи для админки (ADM-30, AUTH-05, AUTH-12, R37, PRIV-07): только учётные записи — email, дата регистрации,
// подтверждение адреса, статус, роль; данных домохозяйства здесь нет. Действия администратора:
// - удалить — после ввода email удаляемого (подтверждение, ConfirmDialog на сайте) тем же путём, что «Удалить аккаунт»
//   (eraseUser), под scope удаляемого из target-user-scope.ts; последнего администратора — LAST_ADMIN;
// - сбросить пароль — ссылка уходит самому пользователю письмом; нет подтверждённой почты, но подключён Telegram (AUTH-05,
//   T-053) — в бот (доставку даёт вызывающий: identity ярусом ниже бота); иначе ссылку показывают администратору: запись в
//   журнал (лог), отметка password_reset_by_admin_at — пользователь увидит «Пароль был сброшен администратором <дата>» и
//   погасит её.
import type { Scope } from "@kosht/kernel";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import type { MailFacade } from "../../mail/index.ts";
import {
  accountOf,
  adminResetMarkOf,
  isDemoUser,
  listAccounts,
  setAdminResetMark,
  type AccountRow,
} from "../infrastructure/db/identity.repo.ts";
import type { EraseUser } from "./erase-user.ts";
import type { PasswordReset } from "./password-reset.ts";
import type { makeTargetUserScope } from "./target-user-scope.ts";

/** Сколько пользователей показывает список (учебная система на одном компьютере). */
export const ACCOUNTS_LIMIT = 1000;

export interface AdminUsersDeps {
  readonly platform: Pick<SystemPlatform, "system" | "clock" | "log">;
  readonly mail: Pick<MailFacade, "send">;
  readonly passwordReset: Pick<PasswordReset, "issueLink">;
  readonly eraseUser: EraseUser;
  readonly targetUserScope: ReturnType<typeof makeTargetUserScope>;
}

/** Итог «Сбросить пароль»: письмо ушло пользователю — или ссылка показана администратору. */
export type AdminResetResult =
  | { readonly delivery: "email" }
  | { readonly delivery: "telegram" }
  | { readonly delivery: "shown"; readonly link: string };

/** Доставка ссылки пользователю не почтой (Telegram): `true` — доставлена; `false` — некуда или не вышло. */
export type ResetLinkDelivery = (target: {
  readonly userId: string;
  readonly link: string;
  readonly minutes: number;
}) => Promise<boolean>;

export function makeAdminUsers(d: AdminUsersDeps) {
  const { platform } = d;

  async function list(): Promise<AccountRow[]> {
    return listAccounts(platform.system, ACCOUNTS_LIMIT);
  }

  /** Удалить пользователя; email — подтверждение: не совпал с адресом удаляемого — VALIDATION, ничего не удалено. */
  async function remove(actor: Scope, targetId: string, email: string): Promise<void> {
    const { scope, account } = await d.targetUserScope(actor, targetId);
    // DEMO-03: демо-пользователя не удаляют — его данные пересоздаёт кнопка «Пересоздать демо-данные».
    if (await isDemoUser(platform.system, targetId)) {
      throw new AppError("CONFLICT", { reason: "demo-user" });
    }
    if (email.trim().toLowerCase() !== account.email) {
      throw new AppError("VALIDATION", { field: "email" });
    }
    await d.eraseUser(scope, account.email);
    platform.log.info({ userId: actor.userId, targetId }, "identity.user-deleted-by-admin");
  }

  async function resetPassword(
    actor: Scope,
    targetId: string,
    deliver?: ResetLinkDelivery,
  ): Promise<AdminResetResult> {
    const target = await accountOf(platform.system, targetId);
    if (target === undefined) throw new AppError("NOT_FOUND");
    if (target.status !== "active") throw new AppError("ACCOUNT_BLOCKED");
    const { link, minutes } = await d.passwordReset.issueLink(targetId);
    if (target.emailVerified) {
      await d.mail.send(target.email, { kind: "reset-password", link, minutes });
      platform.log.info({ userId: actor.userId, targetId }, "identity.admin-reset-mailed");
      return { delivery: "email" };
    }
    if (deliver !== undefined && (await deliver({ userId: targetId, link, minutes }))) {
      platform.log.info({ userId: actor.userId, targetId }, "identity.admin-reset-telegram");
      return { delivery: "telegram" };
    }
    // R37: ссылку видит администратор — только потому, что доставить её пользователю некуда; это в журнале.
    await setAdminResetMark(platform.system, targetId, platform.clock.now());
    platform.log.warn({ userId: actor.userId, targetId }, "identity.admin-reset-link-shown");
    return { delivery: "shown", link };
  }

  return { list, remove, resetPassword };
}

/** Отметка «Пароль был сброшен администратором» для вошедшего: показать и погасить (AUTH-05). */
export function makeAdminResetNotice(d: Pick<SystemPlatform, "system">) {
  return {
    async get(userId: string): Promise<Date | null> {
      return adminResetMarkOf(d.system, userId);
    },
    async acknowledge(userId: string): Promise<void> {
      await setAdminResetMark(d.system, userId, null);
    },
  };
}

export type AdminUsers = ReturnType<typeof makeAdminUsers>;
