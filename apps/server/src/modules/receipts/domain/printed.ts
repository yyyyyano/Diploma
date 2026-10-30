// Разбор напечатанных значений чека (RCPT-03): модель переписывает числа, даты и время как на чеке, а разбирает их код —
// суммы целыми копейками, количество целыми тысячными, день по календарю. Что не разобралось — undefined, а не догадка:
// такая строка станет спорной и уйдёт на перепроверку (RCPT-06).
import { parseMoney } from "@kosht/i18n";
import { LocalDate, type Money } from "@kosht/kernel";

/** Сумма с чека: «2,49», «2.49», «1 234,50», минус — перед числом. */
export function parsePrintedMoney(text: string, currency: string): Money | undefined {
  return parseMoney(text.trim(), currency);
}

const QUANTITY = /^(\d{1,9})(?:[.,](\d{1,3}))?$/;

/** Количество в тысячных долях единицы: «3» → 3000, «0,345» → 345; больше трёх знаков или не число — undefined. */
export function parsePrintedQuantity(text: string): number | undefined {
  const match = QUANTITY.exec(text.replace(/\s/g, ""));
  if (match === null) return undefined;
  const [, whole = "0", fraction = ""] = match;
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  return milli > 0 ? milli : undefined;
}

const DAY_FIRST = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/;
const YEAR_FIRST = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/** День покупки: «12.10.2026», «12.10.26», «2026-10-12»; несуществующий день — undefined. */
export function parsePrintedDate(text: string): LocalDate | undefined {
  const value = text.trim();
  let year: string;
  let month: string;
  let day: string;
  const first = DAY_FIRST.exec(value);
  const second = first === null ? YEAR_FIRST.exec(value) : null;
  if (first !== null) {
    [, day = "", month = "", year = ""] = first;
    if (year.length === 2) year = `20${year}`;
  } else if (second !== null) {
    [, year = "", month = "", day = ""] = second;
  } else {
    return undefined;
  }
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = LocalDate.schema.safeParse(iso);
  return parsed.success ? parsed.data : undefined;
}

const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** Время покупки «чч:мм:сс» (секунды — 00, если не напечатаны); вне суток — undefined. */
export function parsePrintedTime(text: string): string | undefined {
  const match = TIME.exec(text.trim());
  if (match === null) return undefined;
  const [, hours = "", minutes = "", seconds = "00"] = match;
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) return undefined;
  return `${hours.padStart(2, "0")}:${minutes}:${seconds}`;
}

/** Копейки как на чеке — «2,49», без валюты: для описания расхождения перепроверке (только цифры). */
export function plainMoney(minor: number): string {
  const abs = Math.abs(minor);
  const sign = minor < 0 ? "-" : "";
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Количество как на чеке: 3000 → «3», 345 → «0,345», 1500 → «1,5». */
export function plainQuantity(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const fraction = String(milli % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole},${fraction}`;
}
