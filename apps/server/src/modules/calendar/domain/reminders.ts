// Напоминания календаря (CAL-07, CAL-04, NFR-22) — чистые правила: за сколько дней напомнить, какие напоминания создать для события
// и какие из наступивших отправить. «Сейчас» и «сегодня» приходят аргументами; время отправки и пояс — из настроек.
import type { LocalDate, TimeZone } from "@kosht/kernel";
import { dueInstant, remindDate } from "./dates.ts";

export interface ReminderPlan {
  readonly offsetDays: number;
  readonly dueAt: Date;
}

/**
 * CAL-07: напоминания события — по строке на «за сколько дней». Наступивший к моменту создания срок не создаётся: «вчерашнее»
 * напоминание человеку не нужно. У события без дня (правило без даты, CAL-02) напоминаний нет, пока человек не укажет день.
 */
export function planReminders(input: {
  readonly on: LocalDate | null;
  readonly remindDays: readonly number[];
  readonly now: Date;
  readonly time: string;
  readonly timeZone: TimeZone;
}): ReminderPlan[] {
  const { on } = input;
  if (on === null) return [];
  const offsets = [...new Set(input.remindDays)].toSorted((a, b) => b - a);
  return offsets
    .map((offsetDays) => ({
      offsetDays,
      dueAt: dueInstant(remindDate(on, offsetDays), input.time, input.timeZone),
    }))
    .filter((plan) => plan.dueAt.getTime() > input.now.getTime());
}

/** CAL-07, CAL-04: напоминания по умолчанию — гарантия ещё и за 30 дней, остальное — как настроено (7 и 1). */
export function defaultRemindDays(
  type: string,
  settings: { readonly general: readonly number[]; readonly warranty: readonly number[] },
): number[] {
  return [...(type === "warranty" ? settings.warranty : settings.general)];
}

export interface DueReminder {
  readonly id: string;
  readonly eventId: string;
  readonly offsetDays: number;
  /** День события. */
  readonly on: LocalDate;
}

/**
 * NFR-22: наступившие, но не отправленные напоминания (пропуск при выключенном компьютере). Событие прошло — напоминание
 * пропускается; у события несколько наступивших разом — отправляется самое близкое к событию, остальные пропускаются
 * (иначе «за 7 дней» и «за 1 день» придут одной пачкой).
 */
export function decideDelivery(
  due: readonly DueReminder[],
  today: LocalDate,
): { send: DueReminder[]; skip: DueReminder[] } {
  const best = new Map<string, DueReminder>();
  const skip: DueReminder[] = [];
  for (const reminder of due) {
    if (reminder.on < today) {
      skip.push(reminder);
      continue;
    }
    const current = best.get(reminder.eventId);
    if (current === undefined || reminder.offsetDays < current.offsetDays) {
      if (current !== undefined) skip.push(current);
      best.set(reminder.eventId, reminder);
    } else {
      skip.push(reminder);
    }
  }
  const send = due.filter((reminder) => best.get(reminder.eventId)?.id === reminder.id);
  return { send, skip };
}
