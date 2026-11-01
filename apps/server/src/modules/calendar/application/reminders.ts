// Напоминания события (CAL-07, NFR-22): план по настройкам и тик, который отправляет наступившие. План пересобирается при
// создании, правке дня и «Отменить»; тик не верит нагрузке — каждый раз читает наступившие и неотправленные напоминания пользователя.
import { LocalDate } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { decideDelivery, defaultRemindDays, planReminders } from "../domain/reminders.ts";
import {
  dueReminders,
  markReminders,
  replaceReminders,
} from "../infrastructure/db/calendar.repo.ts";
import {
  INSURANCE_REMIND_DAYS,
  REMIND_DAYS,
  REMIND_TIME,
  WARRANTY_REMIND_DAYS,
} from "../settings.ts";
import { TIME_ZONE } from "../../../platform/settings/time-zone.ts";
import type { Deps } from "./deps.ts";

export function makeReminders(d: Deps) {
  const { clock, settings, realtime, log } = d.platform;

  /** Напоминания по умолчанию для типа события (CAL-04, CAL-07). */
  async function defaults(type: string): Promise<number[]> {
    return defaultRemindDays(type, {
      general: await settings.get(REMIND_DAYS),
      warranty: await settings.get(WARRANTY_REMIND_DAYS),
      insurance: await settings.get(INSURANCE_REMIND_DAYS),
    });
  }

  /**
   * Пересобрать напоминания события под день и список «за сколько дней». Отправленные сохраняются, пока день не менялся
   * (`dayChanged` — новый день, значит и напоминания заново).
   */
  async function replan(
    tx: ScopedDb,
    eventId: string,
    input: { day: string | null; remindDays: readonly number[]; dayChanged: boolean },
  ): Promise<void> {
    const plans = planReminders({
      on: input.day === null ? null : LocalDate.parse(input.day),
      remindDays: input.remindDays,
      now: clock.now(),
      time: await settings.get(REMIND_TIME),
      timeZone: await settings.get(TIME_ZONE),
    });
    await replaceReminders(tx, eventId, plans, input.dayChanged);
  }

  /**
   * Тик (раз в минуту, NFR-22): наступившие и неотправленные напоминания пользователя → уведомления «напоминание календаря»,
   * по одному на событие (самое близкое); пропущенное из-за выключенного компьютера догоняется при следующем тике. Событие уже
   * прошло — напоминание пропускается, а не шлётся задним числом. Идемпотентно: ключ уведомления — событие, «за сколько», день.
   */
  async function deliver(s: ScopedDb): Promise<number> {
    const now = clock.now();
    const today = clock.today();
    const due = await dueReminders(s, now);
    if (due.length === 0) return 0;
    const dated = due.flatMap((row) =>
      row.day === null
        ? []
        : [
            {
              id: row.reminderId,
              eventId: row.eventId,
              offsetDays: row.offsetDays,
              on: LocalDate.parse(row.day),
            },
          ],
    );
    const { send, skip } = decideDelivery(dated, today);
    const byId = new Map(due.map((row) => [row.reminderId, row]));
    await s.transaction(async (tx) => {
      for (const reminder of send) {
        const row = byId.get(reminder.id);
        if (row === undefined) continue;
        await d.notifications.notify(tx, {
          kind: "calendar-reminder",
          key: `${row.eventId}:${String(row.offsetDays)}:${reminder.on}`,
          objectRef: { entity: "calendar-event", id: row.eventId },
          params: {
            type: row.type,
            days: LocalDate.daysBetween(today, reminder.on),
            on: reminder.on,
            ...(row.title === null ? {} : { title: row.title }),
            ...(row.rule === null ? {} : { rule: row.rule }),
          },
        });
      }
      await markReminders(
        tx,
        send.map((r) => r.id),
        "sent",
        now,
      );
      await markReminders(
        tx,
        skip.map((r) => r.id),
        "skipped",
        now,
      );
      await realtime.changed(tx, { entity: "calendar-event", ids: send.map((r) => r.eventId) });
    });
    log.info({ count: send.length, total: due.length }, "calendar.reminders-delivered");
    return send.length;
  }

  return { defaults, replan, deliver };
}

export type Reminders = ReturnType<typeof makeReminders>;
