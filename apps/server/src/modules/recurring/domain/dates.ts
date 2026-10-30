// Календарная арифметика регулярных платежей (REC-01, REC-05): чистые функции над днями «ГГГГ-ММ-ДД»; «сегодня» сюда
// приходит только аргументом (часы — у сценария).
import { LocalDate } from "@kosht/kernel";

const DAY_MS = 86_400_000;

export function addDays(day: LocalDate, days: number): LocalDate {
  return LocalDate.parse(
    new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10),
  );
}

/** Дней от `from` до `to` (отрицательно, если `to` раньше). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Номер месяца с начала эры: разница номеров = число месяцев между днями. */
export function monthIndex(day: LocalDate): number {
  const [year = 0, month = 1] = day.split("-").map(Number);
  return year * 12 + (month - 1);
}

export function dayOfMonth(day: LocalDate): number {
  return Number(day.slice(8, 10));
}

export function daysInMonth(index: number): number {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** День месяца с номером `index`: 31-е в коротком месяце — его последний день. */
export function dayInMonth(index: number, day: number): LocalDate {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const clamped = Math.min(day, daysInMonth(index));
  return LocalDate.parse(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`,
  );
}

/**
 * Первая ожидаемая дата платежа, у которого ещё нет повторов (добавлен вручную): ближайший день месяца `anchorDay` не
 * раньше сегодня; еженедельному — через неделю.
 */
export function firstOccurrence(
  period: "week" | "month" | "quarter" | "year",
  anchorDay: number | null,
  today: LocalDate,
): LocalDate {
  if (period === "week" || anchorDay === null) return addDays(today, 7);
  const thisMonth = dayInMonth(monthIndex(today), anchorDay);
  return thisMonth >= today ? thisMonth : dayInMonth(monthIndex(today) + 1, anchorDay);
}

/** Следующая дата после `on` в серии с периодом `period` и днём `anchorDay` (для списка ближайших платежей). */
export function stepAfter(
  period: "week" | "month" | "quarter" | "year",
  on: LocalDate,
  anchorDay: number | null,
): LocalDate {
  if (period === "week") return addDays(on, 7);
  const step = period === "month" ? 1 : period === "quarter" ? 3 : 12;
  return dayInMonth(monthIndex(on) + step, anchorDay ?? dayOfMonth(on));
}
