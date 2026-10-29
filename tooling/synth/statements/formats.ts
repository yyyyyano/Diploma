// Форматы значений синтетических выписок (T-025): у разных «банков» разные даты и суммы. Всё — чистые функции,
// без часов и случайности: генератор повторяем бит в бит.

export type DateStyle = "dd.mm.yyyy" | "dd.mm.yy" | "yyyy-mm-dd" | "mm/dd/yyyy" | "dd-mm-yyyy";
export type AmountStyle = "ru" | "ru-minus" | "en" | "plain";

const two = (n: number) => String(n).padStart(2, "0");

/** Дата ISO «2026-09-15» в стиле банка. */
export function formatDate(iso: string, style: DateStyle): string {
  const [y = "", m = "", d = ""] = iso.split("-");
  switch (style) {
    case "dd.mm.yyyy":
      return `${d}.${m}.${y}`;
    case "dd.mm.yy":
      return `${d}.${m}.${y.slice(2)}`;
    case "yyyy-mm-dd":
      return iso;
    case "mm/dd/yyyy":
      return `${m}/${d}/${y}`;
    case "dd-mm-yyyy":
      return `${d}-${m}-${y}`;
  }
}

/** Разряды по три знака через `sep`. */
function groups(whole: string, sep: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * Сумма в целых копейках → текст. ru: «1 234,56»; ru-minus: то же, а минус — U+2212 (как в PDF банков); en: «1,234.56»;
 * plain: «1234.56». Знак — только у отрицательных.
 */
export function formatAmount(minor: number, style: AmountStyle): string {
  const abs = Math.abs(minor);
  const whole = String(Math.floor(abs / 100));
  const frac = two(abs % 100);
  const sign = minor < 0 ? (style === "ru-minus" ? "−" : "-") : "";
  switch (style) {
    case "ru":
    case "ru-minus":
      return `${sign}${groups(whole, " ")},${frac}`;
    case "en":
      return `${sign}${groups(whole, ",")}.${frac}`;
    case "plain":
      return `${sign}${whole}.${frac}`;
  }
}

/** Без знака — для колонок «Приход»/«Расход» (знак задаёт колонка). */
export function formatAbs(minor: number, style: AmountStyle): string {
  return formatAmount(Math.abs(minor), style);
}
