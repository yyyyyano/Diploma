// Модуль privacy (паспорт — CLAUDE.md): журнал согласий с версией текста (PRIV-01, PRIV-02), источник облачного
// согласия для шлюза llm; архив «Мои данные» (PRIV-05) и удаление данных аккаунта (PRIV-06) по реестру владельцев.
import type { FilesFacade } from "../files/index.ts";
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import { privacyRouter } from "./api/router.ts";
import { makeCloudConsentSource } from "./application/cloud-consent.ts";
import { makeCloudConsentSettings } from "./application/cloud-consent-settings.ts";
import { makeDataExport } from "./application/data-export.ts";
import { makePurgeAccount } from "./application/purge-account.ts";
import { makeRecordRegistrationConsents } from "./application/record-registration-consents.ts";
import { consentChanged, exportReady } from "./events.ts";
import { buildExportJob } from "./jobs/build-export.job.ts";
import { cloudUsers } from "./infrastructure/db/modes.repo.ts";
import { privacyUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface PrivacyFacades {
  readonly files: FilesFacade;
}

export function createPrivacyModule({
  platform,
  facades,
}: ModuleDeps<PrivacyFacades, SystemPlatform>) {
  // Сценарий ставит задачу, задача зовёт сценарий: задача берётся при вызове, когда обе уже созданы.
  const dataExport = makeDataExport({
    ...platform,
    files: facades.files,
    enqueueBuild: (tx, exportId) => platform.jobs.enqueue(tx, buildJob, { exportId }),
  });
  const buildJob = buildExportJob(dataExport.build);
  return defineModule({
    id: "privacy",
    facade: {
      recordRegistrationConsents: makeRecordRegistrationConsents(platform),
      purge: makePurgeAccount(platform),
      isExportReady: dataExport.isReady,
      /** Админка «Пользователи» (ADM-30): id пользователей в облачном режиме — только флаг, без согласий. */
      cloudUsers: () => cloudUsers(platform.system),
    },
    events: [consentChanged, exportReady],
    jobs: [buildJob],
    router: privacyRouter(makeCloudConsentSettings(platform), dataExport),
    userData: privacyUserData(platform.system),
    consentSource: makeCloudConsentSource(platform),
  });
}

/**
 * Что модуль даёт соседям: recordRegistrationConsents(tx, согласия) — в транзакции регистрации; purge(s) — удаление
 * данных аккаунта; isExportReady(s, id) — архив «Мои данные» готов (подписчик notifications); cloudUsers() — кто в
 * облачном режиме (админка).
 */
export type PrivacyFacade = ReturnType<typeof createPrivacyModule>["facade"];
