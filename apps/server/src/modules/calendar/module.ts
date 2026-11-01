// Модуль calendar (паспорт — CLAUDE.md): события и напоминания (CAL-01…07). Хранимые события — свои, гарантии по чекам и (T-048)
// сроки налогов и страховки; даты регулярных платежей, кредитов и поступлений читаются из `recurring` при запросе. Напоминания —
// таблица `calendar_reminders` и минутный тик, который догоняет пропущенное (NFR-22).
import {
  defineModule,
  type ModuleDeps,
  type Platform,
} from "../../platform/module/define-module.ts";
import type { ProfileFacade } from "../profile/index.ts";
import type { TransactionsFacade } from "../transactions/index.ts";
import type { RecurringFacade } from "../recurring/index.ts";
import type { ReceiptsFacade } from "../receipts/index.ts";
import type { NormTablesFacade } from "../norm-tables/index.ts";
import type { NotificationsFacade } from "../notifications/index.ts";
import type { ActionsFacade } from "../actions/index.ts";
import type { ExplainFacade } from "../explain/index.ts";
import type { TaxFacade } from "../tax/index.ts";
import { calendarTools } from "./agent/tools.ts";
import { calendarRouter } from "./api/router.ts";
import {
  DELETE_HANDLER,
  makeEvents,
  RESTORE_HANDLER,
  UNDELETE_HANDLER,
  UNDO_CREATE_HANDLER,
} from "./application/events.ts";
import { makeRead } from "./application/read.ts";
import { makeDeadlines } from "./application/deadlines.ts";
import { makeInsurance, RENEW_HANDLER } from "./application/insurance.ts";
import { makeProperties } from "./application/properties.ts";
import { makeReminders } from "./application/reminders.ts";
import { makeSync } from "./application/sync.ts";
import { makeWarranty } from "./application/warranty.ts";
import { deliverJob } from "./jobs/deliver.job.ts";
import { deliverSweep } from "./jobs/deliver.sweep.ts";
import { CALENDAR_SETTINGS } from "./settings.ts";
import { onFactsChanged } from "./subscriptions/on-facts-changed.ts";
import { onTransactionsChanged } from "./subscriptions/on-transactions-changed.ts";
import { onValuesConfirmed } from "./subscriptions/on-values-confirmed.ts";
import { onWarrantyItemsFound } from "./subscriptions/on-warranty-items-found.ts";
import { calendarUserData } from "./user-data.ts";

/** Фасады модулей из dependsOn (tooling/architecture/modules.ts). */
export interface CalendarFacades {
  readonly profile: ProfileFacade;
  readonly transactions: TransactionsFacade;
  readonly recurring: RecurringFacade;
  readonly receipts: ReceiptsFacade;
  readonly normTables: NormTablesFacade;
  readonly notifications: NotificationsFacade;
  readonly actions: ActionsFacade;
  readonly explain: ExplainFacade;
  readonly tax: TaxFacade;
}

export function createCalendarModule({ platform, facades }: ModuleDeps<CalendarFacades, Platform>) {
  const deps = {
    platform,
    profile: facades.profile,
    transactions: facades.transactions,
    tax: facades.tax,
    recurring: facades.recurring,
    receipts: facades.receipts,
    normTables: facades.normTables,
    notifications: facades.notifications,
    actions: facades.actions,
    explain: facades.explain,
  };
  const reminders = makeReminders(deps);
  const warranty = makeWarranty(deps, reminders);
  const deadlines = makeDeadlines(deps, reminders);
  const properties = makeProperties(deps);
  const insurance = makeInsurance(deps, reminders);
  // Порядок важен: сначала факты об имуществе (вывод из операций), затем события по ним и вопрос о страховке.
  const sync = makeSync(deps, [
    (s) => warranty.sync(s, []),
    properties.derive,
    deadlines.sync,
    insurance.scan,
  ]);
  const read = makeRead(deps, sync.ensure);
  const events = makeEvents(deps, reminders);
  const tools = calendarTools(read, events);
  const deliver = deliverJob(reminders.deliver);
  return defineModule({
    id: "calendar",
    // Соседям: ближайшие хранимые события для главной (DASH-02) и диапазон событий с итогами (итоги недели, сценарии покупки).
    facade: { homeEvents: read.homeEvents, range: read.range },
    router: calendarRouter(read, events, properties, sync.run),
    settings: [...CALENDAR_SETTINGS],
    jobs: [deliver],
    sweeps: [deliverSweep(deliver)],
    subscriptions: [
      onWarrantyItemsFound(warranty.sync),
      onValuesConfirmed(sync.run),
      onFactsChanged(sync.run),
      onTransactionsChanged(sync.run),
    ],
    tools: [tools.listEvents, tools.createEvent],
    undo: {
      [UNDO_CREATE_HANDLER]: events.undoCreate,
      [RESTORE_HANDLER]: events.restore,
      [UNDELETE_HANDLER]: events.undelete,
    },
    confirm: { [DELETE_HANDLER]: events.confirmDelete, [RENEW_HANDLER]: insurance.confirm },
    userData: calendarUserData,
  });
}

/** Что модуль даёт соседям: `homeEvents(s, days, limit)` и `range(s, { from?, to? })` — события календаря с суммами и traceId. */
export type CalendarFacade = ReturnType<typeof createCalendarModule>["facade"];
