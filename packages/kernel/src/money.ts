// Деньги (P1, .claude/rules/calc.md, ARCHITECTURE §7): целые копейки — «minor units» валюты, без float.
// Считает их только @kosht/calc; здесь — форма, проверка и запрет смешивать валюты.
import { z } from "zod";

/** Код валюты ISO 4217: три заглавные латинские буквы («BYN», «USD»). */
export type CurrencyCode = string;

/** Сумма в целых минимальных единицах валюты: 1 234,56 BYN → `{ minor: 123456, currency: "BYN" }`. */
export interface Money {
  readonly minor: number;
  readonly currency: CurrencyCode;
}

const CURRENCY = /^[A-Z]{3}$/;

/** Сложение денег разных валют без явного пересчёта по курсу (STMT-09) — ошибка программы, а не данных. */
export class CurrencyMismatchError extends Error {
  override name = "CurrencyMismatchError";
}

const schema = z
  .object({
    // z.int() — целое в безопасном диапазоне Number: за ним точность копеек теряется молча.
    minor: z.int(),
    currency: z.string().regex(CURRENCY),
  })
  .readonly();

export const Money = {
  /** Схема для входа «с провода» и из БД: те же правила, что у `Money.of`. */
  schema,

  /** Деньги из целых копеек; дробь, NaN, сумма вне безопасного диапазона и неверный код валюты — `RangeError`. */
  of(minor: number, currency: CurrencyCode): Money {
    if (!Number.isSafeInteger(minor)) {
      throw new RangeError(
        `Деньги — целые копейки в безопасном диапазоне, получено ${minor} (${currency}).`,
      );
    }
    if (!CURRENCY.test(currency)) {
      throw new RangeError(`Код валюты — три заглавные латинские буквы, получено «${currency}».`);
    }
    return { minor, currency };
  },

  /** Общая валюта сумм; разные валюты — `CurrencyMismatchError`, пустой список — `RangeError`. */
  sameCurrency(amounts: readonly Money[]): CurrencyCode {
    const [first, ...rest] = amounts;
    if (first === undefined) throw new RangeError("Нет сумм — валюту не из чего взять.");
    const other = rest.find((amount) => amount.currency !== first.currency);
    if (other !== undefined) {
      throw new CurrencyMismatchError(
        `Суммы в разных валютах: ${first.currency} и ${other.currency} — сначала пересчитайте по курсу.`,
      );
    }
    return first.currency;
  },
} as const;
