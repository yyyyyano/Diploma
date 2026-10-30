// Календарный месяц лимитов (BUD-01): «ГГГГ-ММ» из дня, границы месяца и сколько дней осталось до его конца. Чистая
// арифметика над днями «ГГГГ-ММ-ДД»: «сегодня» — во входе (Clock сервера), без часов и Intl.
import { monthEnd } from "@kosht/calc";
import { LocalDate } from "@kosht/kernel";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** «2026-10» для дня «2026-10-28». */
export function monthOf(day: LocalDate): string {
  return day.slice(0, 7);
}

/** Первый и последний день месяца «ГГГГ-ММ»; не месяц — `RangeError`. */
export function monthBounds(month: string): { from: LocalDate; to: LocalDate } {
  if (!MONTH.test(month)) throw new RangeError(`Месяц «${month}»: ожидается ГГГГ-ММ.`);
  const from = LocalDate.parse(`${month}-01`);
  return { from, to: monthEnd(from) };
}

function dayNumber(day: string): number {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / 86_400_000);
}

/**
 * Дней до конца месяца, сегодня включительно: 21.10 → 11 (с 21-го по 31-е). Прошедший месяц — 0, будущий — все дни
 * месяца (отсчёт от его первого дня).
 */
export function daysLeft(today: LocalDate, month: string): number {
  const { from, to } = monthBounds(month);
  if (today > to) return 0;
  const start = today < from ? from : today;
  return dayNumber(to) - dayNumber(start) + 1;
}
