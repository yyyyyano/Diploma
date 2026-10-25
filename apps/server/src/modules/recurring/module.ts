// Модуль recurring (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { ProfileFacade } from "../profile/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface RecurringFacades {
  readonly transactions: TransactionsFacade;
  readonly categories: CategoriesFacade;
  readonly profile: ProfileFacade;
  readonly notifications: NotificationsFacade;
}

export function createRecurringModule(_deps: ModuleDeps<RecurringFacades, Platform>) {
  return defineModule({ id: "recurring" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type RecurringFacade = ReturnType<typeof createRecurringModule>["facade"];
