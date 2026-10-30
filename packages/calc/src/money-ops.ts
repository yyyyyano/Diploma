// Помощники трассы над деньгами (ADR-0017, .claude/rules/calc.md): sum, sub, mul, mulRate, avg, round. Внутри —
// BigInt: промежуточные суммы не теряют копеек, а результат вне безопасного диапазона Number — `RangeError`.
// Деньги разных валют без явного пересчёта не смешиваются (`CurrencyMismatchError`).
import { Money, type CurrencyCode } from "@kosht/kernel";
import { trace, type Calc } from "./calc.ts";
import { divideRounded, roundingNote, type RoundingRule } from "./rounding.ts";

/** Не меньше одного аргумента: у пустой суммы и пустого среднего нет ни валюты, ни смысла. */
export type NonEmpty<T> = readonly [T, ...T[]];

export interface RoundingOptions {
  readonly rounding: RoundingRule;
}

/** 10 000 базисных пунктов = 100 %. */
const BASIS_POINTS = 10_000n;

function toMoney(key: string, minor: bigint, currency: CurrencyCode): Money {
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(
      `${key}: результат ${minor} ${currency} вне безопасного диапазона копеек.`,
    );
  }
  return Money.of(Number(minor), currency);
}

function total(terms: readonly Calc<Money>[]): bigint {
  return terms.reduce((acc, term) => acc + BigInt(term.value.minor), 0n);
}

/** Сумма денег одной валюты; слагаемые — аргументы трассы в том же порядке. */
export function sum(key: string, terms: NonEmpty<Calc<Money>>): Calc<Money> {
  const currency = Money.sameCurrency(terms.map((term) => term.value));
  const value = toMoney(key, total(terms), currency);
  return {
    value,
    trace: trace(
      key,
      "sum",
      value,
      terms.map((term) => term.trace),
    ),
  };
}

/** Уменьшаемое минус вычитаемые; в трассе уменьшаемое — первый аргумент. */
export function sub(
  key: string,
  minuend: Calc<Money>,
  subtrahends: readonly Calc<Money>[],
): Calc<Money> {
  const terms = [minuend, ...subtrahends];
  const currency = Money.sameCurrency(terms.map((term) => term.value));
  const value = toMoney(key, BigInt(minuend.value.minor) - total(subtrahends), currency);
  return {
    value,
    trace: trace(
      key,
      "sub",
      value,
      terms.map((term) => term.trace),
    ),
  };
}

/** Деньги на целое количество (3 × 2,49 = 7,47): округлять нечего. */
export function mul(key: string, amount: Calc<Money>, factor: Calc<number>): Calc<Money> {
  const minor = BigInt(amount.value.minor) * BigInt(factor.value);
  const value = toMoney(key, minor, amount.value.currency);
  return { value, trace: trace(key, "mul", value, [amount.trace, factor.trace]) };
}

/** 1000 тысячных = одна единица товара (штука, килограмм). */
const MILLI = 1_000n;

/**
 * RCPT-05: цена за единицу × количество в тысячных долях единицы (0,345 кг → 345; 3 шт → 3000) с явным округлением
 * до копейки. Количество — узел трассы (целое), цена — деньги; произведение считается на BigInt.
 */
export function mulQuantity(
  key: string,
  unitPrice: Calc<Money>,
  quantityMilli: Calc<number>,
  options: RoundingOptions,
): Calc<Money> {
  const exact = BigInt(unitPrice.value.minor) * BigInt(quantityMilli.value);
  const value = toMoney(
    key,
    divideRounded(exact, MILLI, options.rounding),
    unitPrice.value.currency,
  );
  return {
    value,
    trace: trace(
      key,
      "mul",
      value,
      [unitPrice.trace, quantityMilli.trace],
      [],
      roundingNote(options.rounding),
    ),
  };
}

/** Деньги × ставка в базисных пунктах (1300 = 13 %) с явным округлением; ставка — узел трассы с основаниями. */
export function mulRate(
  key: string,
  base: Calc<Money>,
  rateBp: Calc<number>,
  options: RoundingOptions,
): Calc<Money> {
  const exact = BigInt(base.value.minor) * BigInt(rateBp.value);
  const value = toMoney(
    key,
    divideRounded(exact, BASIS_POINTS, options.rounding),
    base.value.currency,
  );
  return {
    value,
    trace: trace(key, "mul", value, [base.trace, rateBp.trace], [], roundingNote(options.rounding)),
  };
}

/** Среднее денег одной валюты с явным округлением. */
export function avg(
  key: string,
  terms: NonEmpty<Calc<Money>>,
  options: RoundingOptions,
): Calc<Money> {
  const currency = Money.sameCurrency(terms.map((term) => term.value));
  const mean = divideRounded(total(terms), BigInt(terms.length), options.rounding);
  const value = toMoney(key, mean, currency);
  return {
    value,
    trace: trace(
      key,
      "avg",
      value,
      terms.map((term) => term.trace),
      [],
      roundingNote(options.rounding),
    ),
  };
}

/** Округление суммы до шага правила (до рубля — `*-ruble`); правило и шаг — в трассе. */
export function round(key: string, amount: Calc<Money>, options: RoundingOptions): Calc<Money> {
  const minor = divideRounded(BigInt(amount.value.minor), 1n, options.rounding);
  const value = toMoney(key, minor, amount.value.currency);
  return {
    value,
    trace: trace(key, "round", value, [amount.trace], [], roundingNote(options.rounding)),
  };
}
