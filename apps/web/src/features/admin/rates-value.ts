// Значение параметра таблицы ставок на сайте (ADM-11, CAL-02, CAL-04): как его читает и показывает человек по единице параметра.
// Деньги и проценты — десятичная запись («216,50», «13,5» → целое в сотых); месяцы и число месяца — целое; день года — «15.11»
// (месяц × 100 + день на проводе). Сервер хранит целое и сам сверяет значение с нормой, здесь только перевод текста в число и обратно.
import type { RateRow } from "@kosht/contract";
import { formatScaled, parseMoney } from "@kosht/i18n";

type Unit = RateRow["unit"];

const MAX_MONTHS = 600;

/** Ввод человека → целое значение параметра; не годится для единицы — `undefined`. */
export function parseRateValue(unit: Unit, text: string): number | undefined {
  const trimmed = text.trim();
  if (unit === "months" || unit === "day-of-month") {
    if (!/^\d{1,3}$/u.test(trimmed)) return undefined;
    const value = Number(trimmed);
    const max = unit === "months" ? MAX_MONTHS : 31;
    return value >= 1 && value <= max ? value : undefined;
  }
  if (unit === "month-day") {
    const match = /^(\d{1,2})\.(\d{1,2})$/u.exec(trimmed);
    if (match === null) return undefined;
    const day = Number(match[1]);
    const month = Number(match[2]);
    return day >= 1 && day <= 31 && month >= 1 && month <= 12 ? month * 100 + day : undefined;
  }
  const parsed = parseMoney(trimmed, "BYN");
  return parsed === undefined || Number(parsed.minor) < 0 ? undefined : Number(parsed.minor);
}

/** Целое значение → то, что ставят в поле ввода. */
export function rateValueInput(unit: Unit, value: number): string {
  if (unit === "months" || unit === "day-of-month") return String(value);
  if (unit === "month-day") {
    return `${String(value % 100).padStart(2, "0")}.${String(Math.trunc(value / 100)).padStart(2, "0")}`;
  }
  return formatScaled(value, 2).replace(/,00$/u, "");
}
