// Ставка по кредиту, названная человеком («14», «14,5», «14.05»), → сотые доли процента для сервера (1400, 1450, 1405). Разбор
// строки по цифрам, без float: расчёт ставки и суммы кредита — на сервере (P1).
const RATE = /^(\d{1,3})(?:[.,](\d{1,2}))?$/u;

/** Ставка от 0 до 100 % → целые сотые доли процента; иначе `undefined`. */
export function parseRateBp(text: string): number | undefined {
  const match = RATE.exec(text.trim());
  if (match === null) return undefined;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const bp = whole * 100 + fraction;
  return bp <= 10_000 ? bp : undefined;
}

/** Срок в месяцах — целое от 1 до 600; иначе `undefined`. */
export function parseMonths(text: string): number | undefined {
  if (!/^\d{1,3}$/u.test(text.trim())) return undefined;
  const months = Number(text.trim());
  return months >= 1 && months <= 600 ? months : undefined;
}
