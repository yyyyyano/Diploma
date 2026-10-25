// Модуль afford (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { AccountsFacade } from "../accounts/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { RecurringFacade } from "../recurring/index.ts";
import type { FinFacade } from "../fin/index.ts";
import type { BudgetsFacade } from "../budgets/index.ts";
import type { CalendarFacade } from "../calendar/index.ts";
import type { NormTablesFacade } from "../norm-tables/index.ts";
import type { ProfileFacade } from "../profile/index.ts";
import type { ExplainFacade } from "../explain/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface AffordFacades {
  readonly accounts: AccountsFacade;
  readonly transactions: TransactionsFacade;
  readonly recurring: RecurringFacade;
  readonly fin: FinFacade;
  readonly budgets: BudgetsFacade;
  readonly calendar: CalendarFacade;
  readonly normTables: NormTablesFacade;
  readonly profile: ProfileFacade;
  readonly explain: ExplainFacade;
}

export function createAffordModule(_deps: ModuleDeps<AffordFacades, Platform>) {
  return defineModule({ id: "afford" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type AffordFacade = ReturnType<typeof createAffordModule>["facade"];
