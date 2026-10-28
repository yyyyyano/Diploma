// DES-17 в обратную сторону: сумма, введённая человеком («2 400,50», «2400.5», «−12»), → целые копейки. Разбор строки
// без float: «0,1 + 0,2» не превращается в 0,30000000000000004. Не сумма (буквы, три цифры после запятой, пусто) —
// undefined: форма покажет «введите сумму». Сайт денег не считает — он только читает ввод (P1).
import { Money, type CurrencyCode } from "@kosht/kernel";

const AMOUNT = /^([-−]?)(\d{1,15})(?:[.,](\d{1,2}))?$/;

export function parseMoney(text: string, currency: CurrencyCode): Money | undefined {
  // Пробелы между разрядами — любые (обычный, U+00A0, U+202F).
  const compact = text.replace(/[\s  ]/g, "");
  const match = AMOUNT.exec(compact);
  if (match === null) return undefined;
  const [, sign = "", whole = "0", fraction = ""] = match;
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  const value = Number(minor);
  return Money.of(sign === "" || value === 0 ? value : -value, currency);
}
