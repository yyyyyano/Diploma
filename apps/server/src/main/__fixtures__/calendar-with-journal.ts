// Сценарии calendar на настоящих соседях: recurring (платежи по истории), actions (журнал «Отменить», решения «Да/Нет»), explain
// (трассы сумм), таблица ставок norm-tables (срок гарантии из миграции), чеки receipts — настоящие строки. Уведомления — список в
// памяти (идемпотентный по виду и ключу, как настоящий notify); факты профиля — настоящий profile; найденные вычеты tax — список,
// который тест заполняет сам (`found`: вид и налоговый год основания). Время — FakeClock из transactions-with-journal (по умолчанию
// 28.10.2026): тесты двигают его, чтобы проверить тик напоминаний.
import { randomUUID } from "node:crypto";
import type { TestDb } from "@kosht/testing/db";
import type { ScopedDb } from "../../platform/db/scoped-db.ts";
import { createSystemDb } from "../../platform/db/system-db.ts";
import {
  DELETE_HANDLER,
  makeEvents,
  RESTORE_HANDLER,
  UNDELETE_HANDLER,
  UNDO_CREATE_HANDLER,
} from "../../modules/calendar/application/events.ts";
import { makeRead } from "../../modules/calendar/application/read.ts";
import { makeReminders } from "../../modules/calendar/application/reminders.ts";
import { makeSync } from "../../modules/calendar/application/sync.ts";
import { calendarTools } from "../../modules/calendar/agent/tools.ts";
import { makeInsurance, RENEW_HANDLER } from "../../modules/calendar/application/insurance.ts";
import { makeProperties } from "../../modules/calendar/application/properties.ts";
import { makeDeadlines } from "../../modules/calendar/application/deadlines.ts";
import { makeWarranty } from "../../modules/calendar/application/warranty.ts";
import type { Deps } from "../../modules/calendar/application/deps.ts";
import { makeRates } from "../../modules/norm-tables/application/rates.ts";
import {
  insertReceipt,
  replaceItems,
  warrantyItemsOf,
} from "../../modules/receipts/infrastructure/db/receipts.repo.ts";
import { clock, recurringWithJournal } from "./recurring-with-journal.ts";

export { clock };

/** Календарь на настоящих соседях; `rateUp: false` — таблица ставок не даёт подтверждённого срока гарантии. */
export function calendarWithJournal(db: TestDb, options: { rateUp?: boolean } = {}) {
  const r = recurringWithJournal(db);
  const rates = makeRates({
    system: createSystemDb(db.pool),
    legalBase: { fragmentsUnder: async () => [] },
    clock,
    publishConfirmed: async () => {},
  });
  const found: { kind: "education" | "housing" | "children"; year: number }[] = [];
  const deps = {
    platform: r.deps.platform,
    profile: { ...r.deps.profile, setFact: r.facts.set },
    transactions: { list: r.t.ops.list },
    tax: { activeFound: async () => found },
    recurring: { list: r.read.list, upcoming: r.read.upcoming },
    receipts: { warrantyItems: warrantyItemsOf },
    normTables: {
      rate:
        options.rateUp === false
          ? async () => ({ found: false as const, reason: "no-data" as const })
          : rates.value,
    },
    notifications: r.deps.notifications,
    actions: r.t.actions,
    explain: r.t.explain,
  } as unknown as Deps;
  const reminders = makeReminders(deps);
  const warranty = makeWarranty(deps, reminders);
  const deadlines = makeDeadlines(deps, reminders);
  const properties = makeProperties(deps);
  const insurance = makeInsurance(deps, reminders);
  const sync = makeSync(deps, [
    (s) => warranty.sync(s, []),
    properties.derive,
    deadlines.sync,
    insurance.scan,
  ]);
  const read = makeRead(deps, sync.ensure);
  const events = makeEvents(deps, reminders);
  r.t.registerUndo(UNDO_CREATE_HANDLER, events.undoCreate);
  r.t.registerUndo(RESTORE_HANDLER, events.restore);
  r.t.registerUndo(UNDELETE_HANDLER, events.undelete);
  r.t.registerConfirm(DELETE_HANDLER, events.confirmDelete);
  r.t.registerConfirm(RENEW_HANDLER, insurance.confirm);

  /** Чек с одной позицией с гарантией (RCPT-13): настоящие строки receipts и receipt_items. */
  async function warrantyReceipt(
    s: ScopedDb,
    purchaseDate: string,
    name: string,
    store: string | null = "Электросила",
  ) {
    const receipt = await insertReceipt(s, {
      fileId: randomUUID(),
      status: "ok",
      storeName: store,
      purchaseDate,
    });
    await replaceItems(s, receipt.id, [
      {
        position: 1,
        name,
        normalizedName: name.toLowerCase(),
        unit: null,
        quantityMilli: 1000,
        unitPriceMinor: 100,
        discountMinor: 0,
        lineTotalMinor: 100,
        disputed: false,
        warranty: true,
      },
    ]);
    return receipt;
  }

  /** Факт, названный человеком («подтверждён»), или вывод системы («предположение»). */
  async function setFact(
    s: ScopedDb,
    value: Parameters<typeof r.facts.set>[1]["value"],
    status: "confirmed" | "assumed" = "confirmed",
  ) {
    if (status === "assumed") {
      await r.facts.upsertDerivedFact(s, { value, source: "statements" });
      return;
    }
    await r.facts.set(s, { value, source: "user", channel: "web" });
  }

  return {
    r,
    s: r.s(),
    deadlines,
    properties,
    insurance,
    found,
    setFact,
    reminders,
    warranty,
    sync,
    read,
    events,
    warrantyReceipt,
    tools: calendarTools(read, events),
    insuranceNotices: () => r.notices.filter((n) => n.kind === "insurance-renewal"),
    calendarNotices: () => r.notices.filter((n) => n.kind === "calendar-reminder"),
  };
}
