// Модуль norm-tables (паспорт — CLAUDE.md): таблица ставок «параметр → период → значение → источник» с подтверждением человеком
// (TAX-03, ADM-11), сверка с новой редакцией закона (LAW-33). Калькулятор берёт значения фасадом `rates.value`, админка — `admin`.
import {
  defineModule,
  type ModuleDeps,
  type SystemPlatform,
} from "../../platform/module/define-module.ts";
import type { LegalBaseFacade } from "../legal-base/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import { makeDriftCheck } from "./application/drift-check.ts";
import { makeRates } from "./application/rates.ts";
import { valuesConfirmed } from "./events.ts";
import { onActUpdated } from "./subscriptions/on-act-updated.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface NormTablesFacades {
  readonly legalBase: LegalBaseFacade;
  readonly notifications: NotificationsFacade;
}

export function createNormTablesModule({
  platform,
  facades,
}: ModuleDeps<NormTablesFacades, SystemPlatform>) {
  const rates = makeRates({
    system: platform.system,
    clock: platform.clock,
    publishConfirmed: (tx, ids) => platform.events.publish(tx, valuesConfirmed, { ids: [...ids] }),
  });
  const drift = makeDriftCheck({
    system: platform.system,
    legalBase: facades.legalBase,
    notifications: facades.notifications,
    clock: platform.clock,
    log: platform.log,
  });
  return defineModule({
    id: "norm-tables",
    facade: {
      /** Подтверждённое значение параметра на день или явное «нет данных» (TAX-03, LEGAL-08). */
      rate: rates.value,
      /** Админка «Таблица ставок» (ADM-11): таблица, предложить, подтвердить, отклонить. */
      admin: {
        table: rates.table,
        propose: rates.propose,
        confirm: rates.confirm,
        reject: rates.reject,
      },
      /** Сверка с редакцией закона (LAW-33): зовёт подписка и тесты. */
      checkDrift: drift,
    },
    events: [valuesConfirmed],
    subscriptions: [onActUpdated(drift)],
  });
}

/** Что модуль даёт соседям: значение ставки, админка таблицы, сверка с редакцией. */
export type NormTablesFacade = ReturnType<typeof createNormTablesModule>["facade"];
