// DES-17: сумма для человека — «1 234,56 BYN». Строка собирается из целых копеек через BigInt, без деления в float
// и без Intl: Intl в разных версиях ICU ставит между разрядами то U+00A0, то U+202F, а float теряет копейки за
// 2^53. Код валюты дописывается как есть (ISO, не символ). У всех поддерживаемых валют две цифры после запятой
// (packages/calc/CLAUDE.md: шаг `ruble` = 100); валюта с другим числом цифр — отдельная задача.
import type { Money } from "@kosht/kernel";

// Через коды, а не литералами: форматтер заменяет экранированные символы невидимыми, их не видно в тексте.
/** Неразрывный пробел: между разрядами и перед кодом валюты (сумма не рвётся переносом строки). */
const NBSP = String.fromCharCode(0x00a0);
/** Типографский минус U+2212, а не дефис. */
const MINUS = String.fromCharCode(0x2212);

const CURRENCY = /^[A-Z]{3}$/;

/** Целые разряды с неразрывным пробелом через каждые три цифры справа: «1 000 000». */
function groupThousands(digits: string): string {
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return groups.join(NBSP);
}

/** Сумма по частям — для вёрстки, где код валюты мельче, а знак ставится по смыслу (доход «+», расход «−»). */
export interface MoneyParts {
  /** Сумма меньше нуля (−0 — не меньше). */
  readonly negative: boolean;
  /** Модуль суммы: «1 234,56» — U+00A0 между разрядами, запятая перед копейками. */
  readonly amount: string;
  /** Код ISO: «BYN». */
  readonly currency: string;
}

/** Части «1 234,56 BYN». Не целые копейки или неверный код валюты — `RangeError`, а не неверная строка. */
export function formatMoneyParts(money: Money): MoneyParts {
  if (!Number.isSafeInteger(money.minor)) {
    throw new RangeError(`Деньги — целые копейки в безопасном диапазоне, получено ${money.minor}.`);
  }
  if (!CURRENCY.test(money.currency)) {
    throw new RangeError(
      `Код валюты — три заглавные латинские буквы, получено «${money.currency}».`,
    );
  }
  const minor = BigInt(money.minor);
  const abs = minor < 0n ? -minor : minor;
  const units = groupThousands((abs / 100n).toString());
  const cents = (abs % 100n).toString().padStart(2, "0");
  return { negative: minor < 0n, amount: `${units},${cents}`, currency: money.currency };
}

/** «1 234,56 BYN», «−840,00 BYN». Не целые копейки или неверный код валюты — `RangeError`, а не неверная строка. */
export function formatMoney(money: Money): string {
  const { negative, amount, currency } = formatMoneyParts(money);
  return `${negative ? MINUS : ""}${amount}${NBSP}${currency}`;
}
