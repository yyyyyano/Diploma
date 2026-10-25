// Модуль demo (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { IdentityFacade } from "../identity/index.ts";
import type { PrivacyFacade } from "../privacy/index.ts";
import type { ProfileFacade } from "../profile/index.ts";
import type { FilesFacade } from "../files/index.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { ReceiptsFacade } from "../receipts/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { RecurringFacade } from "../recurring/index.ts";
import type { BudgetsFacade } from "../budgets/index.ts";
import type { CalendarFacade } from "../calendar/index.ts";
import type { WeeklyFacade } from "../weekly/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface DemoFacades {
  readonly identity: IdentityFacade;
  readonly privacy: PrivacyFacade;
  readonly profile: ProfileFacade;
  readonly files: FilesFacade;
  readonly accounts: AccountsFacade;
  readonly transactions: TransactionsFacade;
  readonly receipts: ReceiptsFacade;
  readonly categories: CategoriesFacade;
  readonly recurring: RecurringFacade;
  readonly budgets: BudgetsFacade;
  readonly calendar: CalendarFacade;
  readonly weekly: WeeklyFacade;
}

export function createDemoModule(_deps: ModuleDeps<DemoFacades, Platform>) {
  return defineModule({ id: "demo" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type DemoFacade = ReturnType<typeof createDemoModule>["facade"];
