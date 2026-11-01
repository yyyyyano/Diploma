// Гарантии (CAL-04, RCPT-13): по каждой позиции чека с гарантией — событие «конец гарантии» с датой покупки + срок из таблицы
// (`warranty.default-months`, ст. 21 Закона № 90-З: два года, если срок не установлен или меньше двух лет). Срок — только
// подтверждённое значение таблицы: нет его — события нет (пересчёт — при открытии календаря и по подтверждению значения).
// Событие одно на позицию (ключ `warranty:<позиция>`): повтор события чека дубль не создаёт, правки человека не затирает.
import { LocalDate } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { addMonths } from "../domain/dates.ts";
import { findByKey, insertEvent } from "../infrastructure/db/calendar.repo.ts";
import type { Deps } from "./deps.ts";
import type { Reminders } from "./reminders.ts";

export const WARRANTY_RATE = "warranty.default-months";

export function makeWarranty(d: Deps, reminders: Reminders) {
  const { clock, realtime, log } = d.platform;

  /**
   * События «конец гарантии» для позиций чеков `receiptIds` (пусто — всех чеков пользователя); возвращает число созданных.
   * Гарантия, что уже закончилась, события не получает: напоминать не о чем.
   */
  async function sync(s: ScopedDb, receiptIds: readonly string[]): Promise<number> {
    const today = clock.today();
    const items = await d.receipts.warrantyItems(s, receiptIds);
    const created: string[] = [];
    for (const item of items) {
      if (item.purchasedOn === null) continue;
      const key = `warranty:${item.itemId}`;
      if ((await findByKey(s, key)) !== undefined) continue;
      const purchasedOn = LocalDate.parse(item.purchasedOn);
      // Срок — по норме на день покупки; покупка раньше начала таблицы — действующее значение (срок «два года» — общее правило закона).
      let rate = await d.normTables.rate(WARRANTY_RATE, purchasedOn);
      if (!rate.found) rate = await d.normTables.rate(WARRANTY_RATE, today);
      if (!rate.found) continue;
      const end = addMonths(purchasedOn, rate.value);
      if (end < today) continue;
      const remindDays = await reminders.defaults("warranty");
      const id = await s.transaction(async (tx) => {
        const eventId = await insertEvent(tx, {
          type: "warranty",
          title: item.name,
          day: end,
          origin: "warranty",
          params: {
            ...(item.store === null ? {} : { store: item.store }),
            purchasedOn,
            months: rate.value,
          },
          refEntity: "receipt",
          refId: item.receiptId,
          key,
          remindDays,
        });
        if (eventId === undefined) return undefined;
        await reminders.replan(tx, eventId, { day: end, remindDays, dayChanged: true });
        await realtime.changed(tx, { entity: "calendar-event", ids: [eventId] });
        return eventId;
      });
      if (id !== undefined) created.push(id);
    }
    if (created.length > 0) log.info({ count: created.length }, "calendar.warranty-events-created");
    return created.length;
  }

  return { sync };
}

export type Warranty = ReturnType<typeof makeWarranty>;
