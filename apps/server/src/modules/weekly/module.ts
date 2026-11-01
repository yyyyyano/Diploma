// Модуль weekly (паспорт — CLAUDE.md): итоги недели (T-050, WEEK-01…03). Числа считают соседи и `@kosht/calc`, текст пишет модель по
// готовым числам (страж чисел — `NumberLedger` из llm) или шаблон словаря, когда модели нет; сводки хранятся, последняя — карточка
// на главной. Обход раз в 15 минут сверяет день и время пользователя; отправка в бот — T-053.
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { IdentityFacade } from "../identity/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { BudgetsFacade } from "../budgets/index.ts";
import type { CalendarFacade } from "../calendar/index.ts";
import type { CategoriesFacade } from "../categories/index.ts";
import type { RecurringFacade } from "../recurring/index.ts";
import type { TaxFacade } from "../tax/index.ts";
import type { LlmFacade } from "../llm/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { ExplainFacade } from "../explain/index.ts";
import { weeklyRouter } from "./api/router.ts";
import { makeFacts } from "./application/facts.ts";
import { makeRead } from "./application/read.ts";
import { makeRun } from "./application/run.ts";
import { makeText } from "./application/text.ts";
import { buildJob } from "./jobs/build.job.ts";
import { buildSweep } from "./jobs/build.sweep.ts";
import { WEEKLY_SETTINGS } from "./settings.ts";
import { onUserRegistered } from "./subscriptions/on-user-registered.ts";
import { weeklyUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface WeeklyFacades {
  readonly transactions: TransactionsFacade;
  readonly budgets: BudgetsFacade;
  readonly calendar: CalendarFacade;
  readonly categories: CategoriesFacade;
  readonly recurring: RecurringFacade;
  readonly tax: TaxFacade;
  readonly llm: LlmFacade;
  readonly notifications: NotificationsFacade;
  readonly explain: ExplainFacade;
  readonly identity: IdentityFacade;
}

export function createWeeklyModule({ platform, facades }: ModuleDeps<WeeklyFacades, Platform>) {
  const deps = { platform, ...facades };
  const facts = makeFacts(deps);
  const text = makeText(deps);
  const run = makeRun(deps, facts, text);
  const read = makeRead(deps);
  const build = buildJob(run);
  return defineModule({
    id: "weekly",
    // Соседям: последняя сводка для карточки главной (DASH-02) и история.
    facade: { latest: read.latest, history: read.history },
    router: weeklyRouter(read),
    settings: [...WEEKLY_SETTINGS],
    jobs: [build],
    sweeps: [buildSweep(build)],
    subscriptions: [onUserRegistered()],
    userData: weeklyUserData,
  });
}

/** Что модуль даёт соседям: `latest(s)` → последняя `WeeklySummary` или `null`, `history(s, limit?)`. */
export type WeeklyFacade = ReturnType<typeof createWeeklyModule>["facade"];
