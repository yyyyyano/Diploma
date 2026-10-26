// Модуль identity (паспорт — CLAUDE.md): вход (Better Auth — ядро), первый запуск, сессии сайта и перепроверка
// владельцев задач для всего процесса (ARCHITECTURE §6.4).
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { MailFacade } from "../mail/index.ts";
import type { PrivacyFacade } from "../privacy/index.ts";
import { identityRouter } from "./api/router.ts";
import { makeAdminGuard } from "./application/admins.ts";
import { makeEmailVerification } from "./application/email-verification.ts";
import { makeRegister } from "./application/register.ts";
import { makeResendVerification } from "./application/resend-verification.ts";
import { makeRecoveryCodes } from "./application/recovery-code.ts";
import { makeSetup } from "./application/setup.ts";
import { makeSignIn, makeSignOut } from "./application/sign-in.ts";
import { makeMe, makeStatus } from "./application/status.ts";
import { makeScopeVerifier } from "./application/verify-scope.ts";
import { systemInitialized, userRegistered } from "./events.ts";
import { createAuth, createAuthGateway } from "./infrastructure/auth.ts";
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
  return defineModule({
    id: "identity",
    facade: admins,
    events: [systemInitialized, userRegistered],
    router: identityRouter({
      status: makeStatus(platform),
      setup: makeSetup({ ...platform, issueRecoveryCode: recoveryCodes.issue }),
      signIn: makeSignIn({ auth, platform }),
      signOut: makeSignOut({ auth }),
      me: makeMe(platform),
      register: makeRegister({ platform, auth, privacy: facades.privacy, verification }),
      verifyEmail: verification.verify,
      resendVerification: makeResendVerification({ platform, verification }),
    }),
    settings: IDENTITY_SETTINGS,
    sessionSource: (headers) => auth.session(headers),
    scopeVerifier: makeScopeVerifier(platform),
  });
}

/**
 * Что модуль даёт соседям (админка T-017, удаление аккаунта T-016): setStatus, setRole, assertRemovable — с защитой
 * последнего администратора (AUTH-12).
 */
export type IdentityFacade = ReturnType<typeof createIdentityModule>["facade"];
