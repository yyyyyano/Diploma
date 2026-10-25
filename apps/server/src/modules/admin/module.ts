// Модуль admin (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { IdentityFacade } from "../identity/index.ts";
import type { PrivacyFacade } from "../privacy/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { MailFacade } from "../mail/index.ts";
import type { LlmFacade } from "../llm/index.ts";
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
  readonly llm: LlmFacade;
  readonly legalBase: LegalBaseFacade;
  readonly normTables: NormTablesFacade;
  readonly system: SystemFacade;
  readonly quality: QualityFacade;
  readonly demo: DemoFacade;
}

export function createAdminModule(_deps: ModuleDeps<AdminFacades, Platform>) {
  return defineModule({ id: "admin" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type AdminFacade = ReturnType<typeof createAdminModule>["facade"];
