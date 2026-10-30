// FIN-20: «по данным за N мес.» — сколько полных календарных месяцев истории есть до текущего (текущий не полон) и за
// какие именно считается свободный остаток. Чистая арифметика над днями «ГГГГ-ММ-ДД»: «сегодня» — во входе.
import { LocalDate } from "@kosht/kernel";

/** По умолчанию считаем за три полных месяца (FIN-20). */
export const FREE_BALANCE_MONTHS = 3;

function monthIndex(day: string): number {
  const [year = 0, month = 1] = day.split("-").map(Number);
  return year * 12 + (month - 1);
}

function daysInMonth(index: number): number {
  const month = index % 12;
  const year = Math.floor(index / 12);
  if (month === 1) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [3, 5, 8, 10].includes(month) ? 30 : 31;
}

function dayOf(index: number, day: number): LocalDate {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const text = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return LocalDate.parse(text);
}

/**
 * Полных месяцев истории: от месяца первой операции (включительно) до прошлого месяца, не больше `max`. Первая операция
 * в этом месяце или операций нет — 0: считать не за что (свободный остаток — `null`, а не ноль).
 */
export function historyMonths(
  firstOperationOn: string | null,
  today: string,
  max: number = FREE_BALANCE_MONTHS,
): number {
  if (firstOperationOn === null) return 0;
  return Math.max(0, Math.min(max, monthIndex(today) - monthIndex(firstOperationOn)));
}

/** Последние `months` полных месяцев до текущего: «июль–сентябрь» при сегодня в октябре и трёх месяцах. */
export function historyWindow(
  today: string,
  months: number,
): { readonly from: LocalDate; readonly to: LocalDate } {
  const current = monthIndex(today);
  return { from: dayOf(current - months, 1), to: dayOf(current - 1, daysInMonth(current - 1)) };
}
