// Модуль identity (паспорт — CLAUDE.md): вход (Better Auth — ядро), первый запуск, сессии сайта и перепроверка
// владельцев задач для всего процесса (ARCHITECTURE §6.4).
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { HouseholdId, UserId } from "@kosht/kernel";
import type { ScopedDb } from "../../platform/db/scoped-db.ts";
import type { MailFacade } from "../mail/index.ts";
import type { PrivacyFacade } from "../privacy/index.ts";
import { identityRouter } from "./api/router.ts";
import { makeAdminGuard } from "./application/admins.ts";
import { makeAdminResetNotice, makeAdminUsers } from "./application/admin-users.ts";
import { makeChangePassword } from "./application/change-password.ts";
import { makeDeleteAccount } from "./application/delete-account.ts";
import { makeEmailVerification } from "./application/email-verification.ts";
import { makeEraseUser } from "./application/erase-user.ts";
import { makePasswordReset } from "./application/password-reset.ts";
import { makePublishSystemEvent } from "./application/publish-system-event.ts";
import { makeRecoveryCodes } from "./application/recovery-code.ts";
import { makeRegister } from "./application/register.ts";
import { makeResendVerification } from "./application/resend-verification.ts";
import { makeSetup } from "./application/setup.ts";
import { makeSignIn, makeSignOut } from "./application/sign-in.ts";
import { makeMe, makeStatus } from "./application/status.ts";
import { makeTargetUserScope } from "./application/target-user-scope.ts";
import { makeScopeVerifier } from "./application/verify-scope.ts";
import { systemInitialized, userRegistered } from "./events.ts";
import { createAuth, createAuthGateway } from "./infrastructure/auth.ts";
import { memberState, readLoaderContact } from "./infrastructure/db/identity.repo.ts";
import { IDENTITY_SETTINGS } from "./settings.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface IdentityFacades {
  readonly mail: MailFacade;
  readonly privacy: PrivacyFacade;
}

export function createIdentityModule({
  platform,
  facades,
}: ModuleDeps<IdentityFacades, SystemPlatform>) {
  const auth = createAuthGateway(
    createAuth({
      system: platform.system,
      secret: platform.deriveKey("auth/v1").toString("base64url"),
      baseURL: platform.localOrigin,
    }),
  );
  const verification = makeEmailVerification({ platform, mail: facades.mail });
  const recoveryCodes = makeRecoveryCodes({ platform, auth });
  const admins = makeAdminGuard(platform);
  const passwordReset = makePasswordReset({ platform, mail: facades.mail });
  const eraseUser = makeEraseUser({
    platform,
    admins,
    privacy: facades.privacy,
    mail: facades.mail,
  });
  const adminUsers = makeAdminUsers({
    platform,
    mail: facades.mail,
    passwordReset,
    eraseUser,
    targetUserScope: makeTargetUserScope(platform),
  });
  const me = makeMe(platform);
  return defineModule({
    id: "identity",
    facade: {
      ...admins,
      listAccounts: adminUsers.list,
      removeUser: adminUsers.remove,
      resetUserPassword: adminUsers.resetPassword,
      /**
       * Состояние пользователя для бота (AUTH-11, SEC-04): привязка Telegram даёт id, а активен ли он, не заблокирован ли и
       * в том же ли домохозяйстве — решает identity (`absent` — нет пользователя или домохозяйство другое).
       */
      memberState: (candidate: { userId: UserId; householdId: HouseholdId }) =>
        memberState(platform.system, candidate),
      /** Email вошедшего (тестовое письмо админки — на него). */
      emailOf: async (s: ScopedDb) => (await me(s)).email,
      /** Контакт загрузчика законов с первого запуска (LAW-36): legal-base сохраняет его в своей настройке. */
      loaderContact: () => readLoaderContact(platform.system),
      /**
       * Системное событие без владельца (законы) — от имени первого администратора в его транзакции; ScopedDb администратора
       * из identity не выходит. Нет администратора — `false`, события нет.
       */
      publishSystemEvent: makePublishSystemEvent(platform),
    },
    events: [systemInitialized, userRegistered],
    router: identityRouter({
      status: makeStatus(platform),
      setup: makeSetup({ ...platform, issueRecoveryCode: recoveryCodes.issue }),
      signIn: makeSignIn({ auth, platform }),
      signOut: makeSignOut({ auth }),
      me,
      adminResetNotice: makeAdminResetNotice(platform),
      register: makeRegister({ platform, auth, privacy: facades.privacy, verification }),
      verifyEmail: verification.verify,
      resendVerification: makeResendVerification({ platform, verification }),
      passwordReset,
      recoveryCodes,
      changePassword: makeChangePassword({ auth, platform }),
      deleteAccount: makeDeleteAccount({ platform, auth, eraseUser }),
    }),
    settings: IDENTITY_SETTINGS,
    sessionSource: (headers) => auth.session(headers),
    scopeVerifier: makeScopeVerifier(platform),
  });
}

/**
 * Что модуль даёт соседям (админка T-017, удаление аккаунта T-016): setStatus, setRole, assertRemovable — с защитой
 * последнего администратора (AUTH-12); listAccounts, removeUser, resetUserPassword — экран «Пользователи»
 * (ADM-30, R37); emailOf — адрес вошедшего.
 */
export type IdentityFacade = ReturnType<typeof createIdentityModule>["facade"];
