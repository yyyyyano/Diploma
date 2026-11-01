// Даты сценариев покупки (AFF-03): сдвиг на месяцы с прижатием к концу месяца (31 января + 1 месяц = 28 февраля) — для
// «наберёте к июлю 2027» и повторов ожидаемого дохода. «Сегодня» — только аргументом (`platform.clock`).
import { LocalDate } from "@kosht/kernel";

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** День через `months` месяцев; число месяца прижимается к последнему дню нового месяца. */
export function addMonths(day: LocalDate, months: number): LocalDate {
  if (!Number.isSafeInteger(months) || months < 0) {
    throw new RangeError("Число месяцев — неотрицательное целое.");
  }
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  const index = year * 12 + (month - 1) + months;
  const newYear = Math.floor(index / 12);
  const newMonth = (index % 12) + 1;
  const newDate = Math.min(date, daysInMonth(newYear, newMonth));
  return LocalDate.parse(
    `${String(newYear).padStart(4, "0")}-${String(newMonth).padStart(2, "0")}-${String(newDate).padStart(2, "0")}`,
  );
}

/**
 * Дни повторяющегося ежемесячного поступления от `first` (включительно) до `to`: тот же день месяца, короткий месяц — последний день.
 * Число месяца берётся от первого дня, а не от предыдущего повтора: 31 января → 28 февраля → 31 марта.
 */
export function monthlyDays(first: LocalDate, to: LocalDate): LocalDate[] {
  const days: LocalDate[] = [];
  for (let step = 0; step < 240; step += 1) {
    const day = addMonths(first, step);
    if (day > to) break;
    days.push(day);
  }
  return days;
}
