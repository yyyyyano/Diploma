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
import { makeSetup } from "./application/setup.ts";
import { makeSignIn, makeSignOut } from "./application/sign-in.ts";
import { makeMe, makeStatus } from "./application/status.ts";
import { makeScopeVerifier } from "./application/verify-scope.ts";
import { systemInitialized, userRegistered } from "./events.ts";
import { createAuth, createAuthGateway } from "./infrastructure/auth.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface IdentityFacades {
  readonly mail: MailFacade;
  readonly privacy: PrivacyFacade;
}

export function createIdentityModule({ platform }: ModuleDeps<IdentityFacades, SystemPlatform>) {
  const auth = createAuthGateway(
    createAuth({
      system: platform.system,
      secret: platform.deriveKey("auth/v1").toString("base64url"),
      baseURL: platform.localOrigin,
    }),
  );
  return defineModule({
    id: "identity",
    events: [systemInitialized, userRegistered],
    router: identityRouter({
      status: makeStatus(platform),
      setup: makeSetup(platform),
      signIn: makeSignIn({ auth, platform }),
      signOut: makeSignOut({ auth }),
      me: makeMe(platform),
    }),
    sessionSource: (headers) => auth.session(headers),
    scopeVerifier: makeScopeVerifier(platform),
  });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type IdentityFacade = ReturnType<typeof createIdentityModule>["facade"];
