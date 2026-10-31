// Модуль admin (паспорт — CLAUDE.md): раздел «Администрирование» — процедуры contract.admin.* поверх admin-фасадов
// соседей (ADM-30 «Пользователи», ADM-60 «Система»); своих данных нет (PRIV-07).
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { IdentityFacade } from "../identity/index.ts";
import { adminRouter } from "./api/router.ts";
import { makeAdminUsers } from "./application/admin-users.ts";
import type { PrivacyFacade } from "../privacy/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { MailFacade } from "../mail/index.ts";
import type { LlmAdminFacade } from "../llm/index.ts";
import type { LegalBaseFacade } from "../legal-base/index.ts";
import type { NormTablesFacade } from "../norm-tables/index.ts";
import type { SystemFacade } from "../system/index.ts";
import type { QualityFacade } from "../quality/index.ts";
import type { DemoFacade } from "../demo/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface AdminFacades {
  readonly identity: IdentityFacade;
  readonly privacy: PrivacyFacade;
  readonly notifications: NotificationsFacade;
  readonly mail: MailFacade;
  readonly llm: LlmAdminFacade;
  readonly legalBase: LegalBaseFacade;
  readonly normTables: NormTablesFacade;
  readonly system: SystemFacade;
  readonly quality: QualityFacade;
  readonly demo: DemoFacade;
}

export function createAdminModule({ facades }: ModuleDeps<AdminFacades, Platform>) {
  return defineModule({
    id: "admin",
    router: adminRouter({
      users: makeAdminUsers(facades),
      identity: facades.identity,
      system: facades.system,
      mail: facades.mail,
      llm: facades.llm.admin,
      laws: facades.legalBase.admin,
      rates: facades.normTables.admin,
    }),
  });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type AdminFacade = ReturnType<typeof createAdminModule>["facade"];
