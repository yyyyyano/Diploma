// REC-05: платёж не пришёл через 10 дней после ожидаемой даты — «возможно прекращён» и одно уведомление. Время идёт и без
// новых операций, поэтому проверку делает ежедневный обход (jobs/check-missed.sweep.ts), а не только пересчёт по
// операциям. Уведомление одно на ключ «платёж + ожидаемая дата»: повтор обхода или доставки не дублирует его.
import type { LocalDate } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { daysBetween } from "../domain/dates.ts";
import { missedFrom } from "../domain/rules.ts";
import { recurringChanged } from "../events.ts";
import { lockItem, updateItem } from "../infrastructure/db/recurring.repo.ts";
import { MISSED_DAYS, MISSED_PERCENT } from "../settings.ts";
import type { Deps } from "./deps.ts";
import type { makeSyncFacts } from "./facts.ts";

export function makeMissed(d: Deps, syncFacts: ReturnType<typeof makeSyncFacts>) {
  const { clock, events, realtime, settings, log } = d.platform;

  /** Проверить один платёж на сегодня; `true` — помечен «возможно прекращён». */
  return async function checkMissed(s: ScopedDb, itemId: string): Promise<boolean> {
    const window = {
      monthlyDays: await settings.get(MISSED_DAYS),
      otherPercent: await settings.get(MISSED_PERCENT),
    };
    const today = clock.today();
    const marked = await s.transaction(async (tx) => {
      const row = await lockItem(tx, itemId);
      // Платёж могли исключить, прекратить или оживить, пока задача ждала: перечитываем, нагрузке не верим.
      if (row === undefined || row.state !== "active" || row.source !== "detected") return false;
      const expected = row.nextExpectedOn as LocalDate;
      if (row.ackExpectedOn === expected) return false;
      const from = missedFrom(
        expected,
        row.period as "week" | "month" | "quarter" | "year",
        window,
      );
      if (from > today) return false;
      await updateItem(tx, itemId, { state: "maybe-ended" }, clock.now());
      await d.notifications.notify(tx, {
        kind: "recurring-missed",
        key: `${itemId}:${expected}`,
        objectRef: { entity: "recurring", id: itemId },
        params: { days: daysBetween(expected, today) },
      });
      await events.publish(tx, recurringChanged, { ids: [itemId] });
      await realtime.changed(tx, { entity: "recurring", ids: [itemId] });
      return true;
    });
    if (marked) {
      await syncFacts(s);
      log.info({ recurringId: itemId }, "recurring.maybe-ended");
    }
    return marked;
  };
}
