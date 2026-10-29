// Значения ячеек выписки (STMT-04): суммы и даты в форматах разных банков. Только чистые функции: «сегодня» и локаль не
// нужны, суммы — целые копейки без float (P1).

/** Разряды: обычный, неразрывный (U+00A0), узкий неразрывный (U+202F) и тонкий (U+2009) пробелы. */
const SPACES = /[\s   ]/g;

/**
 * Сумма из текста → целые копейки со знаком; не сумма — undefined. Минус: «-», «−» (U+2212), «–», скобки «(12,50)»,
 * минус после числа «12,50-». Разделитель дробной части задан колонкой (decimal): «1 234,56» и «1,234.56» — разные
 * тексты, а «1.234» без указания не угадать. Валюта и мусор вокруг числа отбрасываются; больше двух знаков после
 * разделителя — не копейки, а значит не сумма.
 */
export function parseAmount(text: string, decimal: "," | "."): number | undefined {
  let value = text.trim();
  if (value === "") return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  value = value.replace(SPACES, "");
  if (/[-−–—]$/.test(value)) {
    negative = true;
    value = value.slice(0, -1);
  }
  const leading = /^([+\-−–—])/.exec(value);
  if (leading !== null) {
    if (leading[1] !== "+") negative = !negative;
    value = value.slice(1);
  }
  // Код или знак валюты рядом с числом: «12,50BYN», «$12.50», «12,50р.».
  value = value.replace(/^[^\d,.+\-\u2212\u2013\u2014]+|[^\d,.]+$/g, "");
  const thousands = decimal === "," ? "." : ",";
  // Разряды — только группами по три знака («1.234.567,00»): «1.2.3» — не сумма.
  if (value.includes(thousands)) {
    const grouped = new RegExp(`^\\d{1,3}(?:\\${thousands}\\d{3})+(?:\\${decimal}\\d{1,2})?$`);
    if (!grouped.test(value)) return undefined;
  }
  value = value.replaceAll(thousands, "").replace(decimal, ".");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return undefined;
  const [whole = "0", fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) return undefined;
  return negative ? -minor : minor;
}

/** Разделитель дробной части колонки по образцам: «,» или «.»; без дробей (целые суммы) — undefined. */
export function detectDecimal(samples: readonly string[]): "," | "." | undefined {
  let comma = 0;
  let dot = 0;
  for (const sample of samples) {
    const text = sample.trim();
    if (/,\d{1,2}\D*$/.test(text)) comma++;
    else if (/\.\d{1,2}\D*$/.test(text) && !/\.\d{3}\D*$/.test(text)) dot++;
  }
  if (comma === 0 && dot === 0) return undefined;
  return comma >= dot ? "," : ".";
}

export interface ParsedDateTime {
  /** ISO «2026-09-15». */
  readonly date: string;
  /** «чч:мм» или undefined. */
  readonly time?: string;
}

const two = (n: number) => String(n).padStart(2, "0");

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const days = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= (days[month - 1] ?? 0);
}

/** «чч:мм» или «чч:мм:сс» в конце текста даты. */
const TIME = /(?:[T\s]+(\d{1,2}):(\d{2})(?::\d{2})?)?\s*$/;

/**
 * Дата (и время, если есть в той же ячейке) из текста; порядок числовой даты задан колонкой. Форматы: «15.09.2026»,
 * «15.09.26», «15/09/2026», «15-09-2026», «2026-09-15», «2026-09-15T10:30:00», «15.09.2026 10:30». Несуществующая дата
 * («31.02.2026») и не дата — undefined.
 */
export function parseDate(text: string, order: "dmy" | "mdy"): ParsedDateTime | undefined {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  let year: number;
  let month: number;
  let day: number;
  let rest: string;
  if (iso !== null) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
    rest = value.slice(iso[0].length);
  } else {
    const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/.exec(value);
    if (numeric === null) return undefined;
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    day = order === "dmy" ? first : second;
    month = order === "dmy" ? second : first;
    year = Number(numeric[3]);
    if (numeric[3]?.length === 2) year += 2000;
    rest = value.slice(numeric[0].length);
  }
  if (!isRealDate(year, month, day)) return undefined;
  const time = TIME.exec(rest);
  if (rest.trim() !== "" && (time === null || time[1] === undefined)) return undefined;
  const result = `${year}-${two(month)}-${two(day)}`;
  return time?.[1] === undefined
    ? { date: result }
    : { date: result, time: `${two(Number(time[1]))}:${time[2]}` };
}

/** Порядок числовых дат по образцам: число больше 12 на первом месте — день первым, на втором — месяц; иначе день первым. */
export function detectDateOrder(samples: readonly string[]): "dmy" | "mdy" {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const sample of samples) {
    const match = /^(\d{1,2})[./-](\d{1,2})[./-]\d{2,4}/.exec(sample.trim());
    if (match === null) continue;
    if (Number(match[1]) > 12) dayFirst++;
    if (Number(match[2]) > 12) monthFirst++;
  }
  return monthFirst > dayFirst ? "mdy" : "dmy";
}

/** «чч:мм» из ячейки времени (допустимо «чч:мм:сс»); иное — undefined. */
export function parseTime(text: string): string | undefined {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text.trim());
  if (match === null || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined;
  return `${two(Number(match[1]))}:${match[2]}`;
}
