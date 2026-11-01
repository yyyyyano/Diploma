// Календарная арифметика событий (CAL-01, CAL-04, CAL-07, NFR-23): конец гарантии, день и момент напоминания, сетка месяца и группы
// списка. Только `LocalDate` и целые числа; пояс системы приходит аргументом, «сегодня» — тоже.
import { LocalDate, type TimeZone } from "@kosht/kernel";

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function parts(date: LocalDate): [number, number, number] {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return [y, m, d];
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * CAL-04: тот же день через `months` месяцев; нет такого дня (31 января + 1 месяц) — последний день месяца. Гарантия «на 2 года»
 * заканчивается в тот же день и месяц, а не на 730-й день.
 */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const [year, month, day] = parts(date);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return LocalDate.parse(`${pad(y, 4)}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`);
}

/** CAL-07: день напоминания — за `offsetDays` дней до события. */
export function remindDate(on: LocalDate, offsetDays: number): LocalDate {
  return LocalDate.addDays(on, -offsetDays);
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/u;

/** Сдвиг пояса от UTC в миллисекундах в момент `instant` (по Intl: часы и дата пояса как UTC). */
function zoneOffsetMs(instant: number, timeZone: TimeZone): number {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const n = (type: string) => Number(p.find((item) => item.type === type)?.value ?? 0);
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return local - Math.floor(instant / 1000) * 1000;
}

/**
 * NFR-23: момент, когда в поясе `timeZone` наступает «день, чч:мм». Догадка по UTC уточняется сдвигом пояса в этот момент
 * (два прохода — хватает и на переход на летнее время). Не «чч:мм» — `RangeError`.
 */
export function dueInstant(day: LocalDate, time: string, timeZone: TimeZone): Date {
  const match = CLOCK.exec(time);
  if (match === null) throw new RangeError(`Время суток — «чч:мм», получено «${time}».`);
  const [y, m, d] = parts(day);
  const wall = Date.UTC(y, m - 1, d, Number(match[1]), Number(match[2]));
  let instant = wall - zoneOffsetMs(wall, timeZone);
  instant = wall - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

/** День недели, 0 — понедельник. */
function weekday(date: LocalDate): number {
  const [y, m, d] = parts(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** CAL-01: сетка месяца «ГГГГ-ММ» — с понедельника первой недели по воскресенье последней. */
export function monthGrid(month: string): { from: LocalDate; to: LocalDate } {
  const first = LocalDate.parse(`${month}-01`);
  const [y, m] = parts(first);
  const last = LocalDate.parse(`${month}-${pad(daysInMonth(y, m))}`);
  return {
    from: LocalDate.addDays(first, -weekday(first)),
    to: LocalDate.addDays(last, 6 - weekday(last)),
  };
}

export interface GroupBound {
  /** `week-0`, `week-1`, `month-ГГГГ-ММ` или `later`. */
  readonly key: string;
  readonly from: LocalDate;
  readonly to: LocalDate | null;
}

/**
 * CAL-01: границы групп списка «Ближайшие» — эта неделя (до воскресенья), следующая, месяцы до `horizon` (последний — по
 * горизонт включительно) и «Позже» (без конца).
 */
export function groupBounds(today: LocalDate, horizon: LocalDate): GroupBound[] {
  const thisEnd = LocalDate.addDays(today, 6 - weekday(today));
  const nextEnd = LocalDate.addDays(thisEnd, 7);
  const groups: GroupBound[] = [
    { key: "week-0", from: today, to: thisEnd },
    { key: "week-1", from: LocalDate.addDays(thisEnd, 1), to: nextEnd },
  ];
  let from = LocalDate.addDays(nextEnd, 1);
  while (from <= horizon) {
    const [y, m] = parts(from);
    const monthEnd = LocalDate.parse(`${pad(y, 4)}-${pad(m)}-${pad(daysInMonth(y, m))}`);
    const to = monthEnd < horizon ? monthEnd : horizon;
    groups.push({ key: `month-${pad(y, 4)}-${pad(m)}`, from, to });
    from = LocalDate.addDays(to, 1);
  }
  groups.push({ key: "later", from, to: null });
  return groups;
}
