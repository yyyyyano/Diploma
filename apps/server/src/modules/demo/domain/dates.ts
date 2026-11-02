// Даты демо относительно «сегодня» (DEMO-02): «последние 6 месяцев» — всегда от дня показа. Чистая арифметика по строкам
// «ГГГГ-ММ-ДД»; «сегодня» приходит из Clock вызывающего.
import { LocalDate } from "@kosht/kernel";

/** Последний день месяца. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parts(day: LocalDate): [number, number, number] {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return [y, m, d];
}

/** День того же числа через `months` месяцев (число прижимается к концу короткого месяца). */
export function shiftMonths(day: LocalDate, months: number): LocalDate {
  const [y, m, d] = parts(day);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return LocalDate.parse(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(d, daysInMonth(year, month))).padStart(2, "0")}`,
  );
}

/** Число `dayOfMonth` в месяце `(year, month)`, прижатое к концу месяца. */
export function dayIn(year: number, month: number, dayOfMonth: number): LocalDate {
  return LocalDate.parse(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(dayOfMonth, daysInMonth(year, month))).padStart(2, "0")}`,
  );
}

/** Месяцы от месяца `from` до месяца `to` включительно как `[год, месяц]`. */
export function monthsBetween(from: LocalDate, to: LocalDate): [number, number][] {
  const [fy, fm] = parts(from);
  const [ty, tm] = parts(to);
  const result: [number, number][] = [];
  for (let index = fy * 12 + fm - 1; index <= ty * 12 + tm - 1; index++) {
    result.push([Math.floor(index / 12), (index % 12) + 1]);
  }
  return result;
}

/** Сколько полных лет прошло от `birth` до `on`. */
export function yearsBetween(birth: LocalDate, on: LocalDate): number {
  const [by, bm, bd] = parts(birth);
  const [oy, om, od] = parts(on);
  return oy - by - (om < bm || (om === bm && od < bd) ? 1 : 0);
}
