// Сетка месяца (CAL-01): дни с понедельника первой недели по воскресенье последней и события по дням. Только даты — деньги не
// считаются (P1): итоги месяца приходят с сервера.
import type { CalendarEntry } from "@kosht/contract";
import { LocalDate } from "@kosht/kernel";

export interface Cell {
  readonly on: LocalDate;
  readonly inMonth: boolean;
  readonly entries: readonly CalendarEntry[];
}

/** Ячейки сетки от `from` до `to` включительно (границы — понедельник и воскресенье), события — по их дню. */
export function buildCells(
  month: string,
  from: LocalDate,
  to: LocalDate,
  entries: readonly CalendarEntry[],
): Cell[] {
  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    if (entry.on === null) continue;
    byDay.set(entry.on, [...(byDay.get(entry.on) ?? []), entry]);
  }
  const cells: Cell[] = [];
  for (let on = from; on <= to; on = LocalDate.addDays(on, 1)) {
    cells.push({ on, inMonth: on.startsWith(month), entries: byDay.get(on) ?? [] });
  }
  return cells;
}

/** Соседний месяц «ГГГГ-ММ»: −1 или +1. */
export function shiftMonth(month: string, delta: -1 | 1): string {
  const [year = 0, number = 1] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}
