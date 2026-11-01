// Расписание итогов недели (WEEK-01, WEEK-03, NFR-22): какую неделю охватывает сводка и пора ли её делать. Всё — по «стенным»
// часам пользователя (день и время по поясу системы, их даёт `Clock` и настройка пояса): сравниваются строки дней и «чч:мм», без
// пересчёта поясов. Пропущенные недели не копятся: из всех прошедших моментов расписания берётся последний — один итог за него.
import { LocalDate } from "@kosht/kernel";

/** День недели дня: 1 — понедельник … 7 — воскресенье. */
export function weekdayOf(day: LocalDate): number {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return ((new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7) + 1;
}

/** Понедельник недели, в которую входит день. */
export function mondayOf(day: LocalDate): LocalDate {
  return LocalDate.addDays(day, 1 - weekdayOf(day));
}

export interface WeekToSummarize {
  /** Последний наступивший момент расписания: день. */
  readonly scheduledOn: LocalDate;
  /** Неделя сводки — полная неделя до недели момента расписания. */
  readonly weekStart: LocalDate;
  readonly weekEnd: LocalDate;
}

/**
 * Последний наступивший момент расписания (день недели `weekday`, время `time`) и неделя сводки: понедельник–воскресенье перед
 * неделей этого момента. В «сегодня» момент ещё не наступил (время не пришло) — берётся прошлый. Не «чч:мм» — `RangeError`.
 */
export function weekToSummarize(input: {
  readonly today: LocalDate;
  /** Текущее время суток «чч:мм». */
  readonly now: string;
  readonly weekday: number;
  readonly time: string;
}): WeekToSummarize {
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/u;
  if (!clock.test(input.time) || !clock.test(input.now)) {
    throw new RangeError("weekly.schedule: время суток — «чч:мм».");
  }
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) {
    throw new RangeError("weekly.schedule: день недели — от 1 до 7.");
  }
  const back = (weekdayOf(input.today) - input.weekday + 7) % 7;
  const passedToday = back === 0 && input.now < input.time;
  const scheduledOn = LocalDate.addDays(input.today, -(back + (passedToday ? 7 : 0)));
  const weekStart = LocalDate.addDays(mondayOf(scheduledOn), -7);
  return { scheduledOn, weekStart, weekEnd: LocalDate.addDays(weekStart, 6) };
}
