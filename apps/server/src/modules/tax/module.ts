// Модуль tax (паспорт — CLAUDE.md): калькулятор налоговых вычетов «Обучение / Жильё / Дети» по ст. 209–211 НК (T-045, TAX-01…07).
// Профиль и таблица ставок дают входные данные, числа считает `@kosht/calc`, каждое показываемое число сохраняет explain, цитаты
// норм подставляет legal-consult. Найденные вычеты по операциям — T-046.
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
import type { ActionsFacade } from "../actions/index.ts";
import type { ExplainFacade } from "../explain/index.ts";
import { taxTools } from "./agent/tools.ts";
import { taxRouter } from "./api/router.ts";
import { makeCalculate } from "./application/calculate.ts";
import { makeDetect } from "./application/detect.ts";
import { makeFound, RESTORE_HANDLER } from "./application/found.ts";
import { TAX_SETTINGS } from "./settings.ts";
import { onFactsChanged, onTransactionsChanged } from "./subscriptions/on-changed.ts";
import { taxUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface TaxFacades {
  readonly profile: ProfileFacade;
  readonly transactions: TransactionsFacade;
  readonly categories: CategoriesFacade;
  readonly normTables: NormTablesFacade;
  readonly legalBase: LegalBaseFacade;
  readonly legalConsult: LegalConsultFacade;
  readonly notifications: NotificationsFacade;
  readonly actions: ActionsFacade;
  readonly explain: ExplainFacade;
}

export function createTaxModule({ platform, facades }: ModuleDeps<TaxFacades, Platform>) {
  const calculate = makeCalculate({
    clock: platform.clock,
    profile: facades.profile,
    normTables: facades.normTables,
    explain: facades.explain,
    legalBase: facades.legalBase,
    legalConsult: facades.legalConsult,
  });
  const found = makeFound({ platform, actions: facades.actions });
  const detect = makeDetect({
    platform,
    profile: facades.profile,
    transactions: facades.transactions,
    notifications: facades.notifications,
    calculate,
  });
  const tools = taxTools(calculate, found);
  return defineModule({
    id: "tax",
    // Соседям: расчёт вычета тем же калькулятором (сумма «до 260» заново не считается); найденные вычеты — для главной (DASH-02).
    facade: { calculate, found: found.list, activeFound: found.active },
    router: taxRouter(calculate, found),
    settings: [...TAX_SETTINGS],
    subscriptions: [onTransactionsChanged(detect), onFactsChanged(detect)],
    tools: [tools.calculateDeduction, tools.foundDeductions],
    undo: { [RESTORE_HANDLER]: found.restore },
    userData: taxUserData,
  });
}

/** Что модуль даёт соседям: `calculate(s, input)` → `DeductionResult`, `found(s)` и `activeFound(s)` — найденные вычеты. */
export type TaxFacade = ReturnType<typeof createTaxModule>["facade"];
