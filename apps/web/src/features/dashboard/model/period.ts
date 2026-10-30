// Период главной (DASH-01): месяц по умолчанию и произвольный. Только арифметика над днями «ГГГГ-ММ-ДД» для выбора
// периода и ссылок в «Операции»; деньги не считаются (P1).
import type { LocalDate } from "@kosht/contract";
import { LocalDate as LocalDateSchema } from "@kosht/contract";

export interface Period {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Первый и последний день месяца «ГГГГ-ММ». */
export function monthRange(month: string): Period {
  const [year = 0, number = 1] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return {
    from: LocalDateSchema.parse(`${month}-01`),
    to: LocalDateSchema.parse(`${month}-${pad(last)}`),
  };
}

/** «ГГГГ-ММ» месяца, сдвинутого на `by` (−1 — предыдущий). */
export function shiftMonth(month: string, by: number): string {
  const [year = 0, number = 1] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + by;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${pad((index % 12) + 1)}`;
}

/** Если период — ровно один календарный месяц, его «ГГГГ-ММ»; иначе `undefined` (свой период). */
export function wholeMonth(period: Period): string | undefined {
  const month = period.from.slice(0, 7);
  const range = monthRange(month);
  return range.from === period.from && range.to === period.to ? month : undefined;
}
