// Модуль telegram (паспорт — CLAUDE.md): пустой, но живой (T-007) — фабрика и описание для корня композиции.
// Сгенерирован make new-module из tooling/architecture/modules.ts; дальше правится задачей модуля.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { ChatFacade } from "../chat/index.ts";
import type { AgentFacade } from "../agent/index.ts";
import type { IdentityFacade } from "../identity/index.ts";
import type { PrivacyFacade } from "../privacy/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { ReceiptsFacade } from "../receipts/index.ts";
import type { StatementsFacade } from "../statements/index.ts";
import type { VoiceFacade } from "../voice/index.ts";
import type { DashboardFacade } from "../dashboard/index.ts";
import type { BudgetsFacade } from "../budgets/index.ts";
import type { WeeklyFacade } from "../weekly/index.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface TelegramFacades {
  readonly chat: ChatFacade;
  readonly agent: AgentFacade;
  readonly identity: IdentityFacade;
  readonly privacy: PrivacyFacade;
  readonly notifications: NotificationsFacade;
  readonly actions: ActionsFacade;
  readonly receipts: ReceiptsFacade;
  readonly statements: StatementsFacade;
  readonly voice: VoiceFacade;
  readonly dashboard: DashboardFacade;
  readonly budgets: BudgetsFacade;
  readonly weekly: WeeklyFacade;
}

export function createTelegramModule(_deps: ModuleDeps<TelegramFacades, SystemPlatform>) {
  return defineModule({ id: "telegram" });
}

/** Что модуль даёт соседям: пока ничего (undefined). */
export type TelegramFacade = ReturnType<typeof createTelegramModule>["facade"];
