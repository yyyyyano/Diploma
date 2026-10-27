// Модуль privacy (паспорт — CLAUDE.md): журнал согласий с версией текста (PRIV-01, PRIV-02), источник облачного
// согласия для шлюза llm; экспорт и удаление аккаунта — T-016.
import {
  defineModule,
  type ModuleDeps,
  type NoFacades,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import { privacyRouter } from "./api/router.ts";
import { makeCloudConsentSource } from "./application/cloud-consent.ts";
import { makeCloudConsentSettings } from "./application/cloud-consent-settings.ts";
import { makePurgeAccount } from "./application/purge-account.ts";
import { makeRecordRegistrationConsents } from "./application/record-registration-consents.ts";
import { consentChanged } from "./events.ts";
import { privacyUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export type PrivacyFacades = NoFacades;

export function createPrivacyModule({ platform }: ModuleDeps<PrivacyFacades, SystemPlatform>) {
  return defineModule({
    id: "privacy",
    facade: {
      recordRegistrationConsents: makeRecordRegistrationConsents(platform),
      purge: makePurgeAccount(platform),
    },
    events: [consentChanged],
    router: privacyRouter(makeCloudConsentSettings(platform)),
    userData: privacyUserData(platform.system),
    consentSource: makeCloudConsentSource(platform),
  });
}

/** Что модуль даёт соседям: recordRegistrationConsents(tx, согласия) — в транзакции регистрации. */
export type PrivacyFacade = ReturnType<typeof createPrivacyModule>["facade"];
