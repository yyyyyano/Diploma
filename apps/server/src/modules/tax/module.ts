// Модуль tax (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { ProfileFacade } from "../profile/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { NormTablesFacade } from "../norm-tables/index.ts";
import type { LegalBaseFacade } from "../legal-base/index.ts";
import type { LegalConsultFacade } from "../legal-consult/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { ExplainFacade } from "../explain/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface TaxFacades {
  readonly profile: ProfileFacade;
  readonly transactions: TransactionsFacade;
  readonly categories: CategoriesFacade;
  readonly normTables: NormTablesFacade;
  readonly legalBase: LegalBaseFacade;
  readonly legalConsult: LegalConsultFacade;
  readonly notifications: NotificationsFacade;
  readonly explain: ExplainFacade;
}

export function createTaxModule(_deps: ModuleDeps<TaxFacades, Platform>) {
  return defineModule({ id: "tax" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type TaxFacade = ReturnType<typeof createTaxModule>["facade"];
