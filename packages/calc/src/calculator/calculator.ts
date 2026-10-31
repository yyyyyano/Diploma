// Калькулятор агента (AGT-03 «калькулятор», P1, P2): детерминированные действия над числами из результатов других
// инструментов — «урезать на треть» (× 1 ÷ 3), «умножить на 12», доля в процентах. Сумма, разность и умножение на
// целое — готовые помощники money-ops; здесь недостающее: произведение на дробь и доля. Округление явное, правило
// и шаг — в трассе. Модель сама арифметику не делает.
import { Money } from "@kosht/kernel";
import { node, trace, type Calc } from "../calc.ts";
import { divideRounded, roundingNote, type RoundingRule } from "../rounding.ts";

export interface ScaleOptions {
  readonly rounding: RoundingRule;
}

function toMoney(key: string, minor: bigint, currency: string): Money {
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${key}: результат вне безопасного диапазона копеек.`);
  }
  return Money.of(Number(minor), currency);
}

/** Деньги × числитель ÷ знаменатель («на треть» — 1 и 3; «на 12 месяцев» — 12 и 1) с явным округлением. */
export function scaleMoney(
  key: string,
  amount: Calc<Money>,
  numerator: Calc<number>,
  denominator: Calc<number>,
  options: ScaleOptions,
): Calc<Money> {
  if (denominator.value <= 0) {
    throw new RangeError(`${key}: знаменатель должен быть больше нуля.`);
  }
  const exact = BigInt(amount.value.minor) * BigInt(numerator.value);
  const value = toMoney(
    key,
    divideRounded(exact, BigInt(denominator.value), options.rounding),
    amount.value.currency,
  );
  return {
    value,
    trace: trace(
      key,
      "mul",
      value,
      [amount.trace, numerator.trace, denominator.trace],
      [],
      `${roundingNote(options.rounding)}; сумма × числитель ÷ знаменатель`,
    ),
  };
}

/** Доля `part` в `whole` в процентах — целое по явному правилу (шаг — 1 %); `whole` больше нуля. */
export function ratioPercent(
  key: string,
  part: Calc<Money>,
  whole: Calc<Money>,
  options: ScaleOptions,
): Calc<number> {
  Money.sameCurrency([part.value, whole.value]);
  if (whole.value.minor <= 0) {
    throw new RangeError(`${key}: целое должно быть больше нуля.`);
  }
  const exact = BigInt(part.value.minor) * 100n;
  // Правило округления задаёт шаг в «копейках»: здесь шаг — один процент, берём режим правила с шагом 1.
  const rule: RoundingRule = options.rounding.endsWith("ruble")
    ? (options.rounding.replace("ruble", "kopeck") as RoundingRule)
    : options.rounding;
  const value = Number(divideRounded(exact, BigInt(whole.value.minor), rule));
  return {
    value,
    trace: trace(
      key,
      "round",
      value,
      [part.trace, whole.trace],
      [],
      `${roundingNote(rule)}; часть × 100 ÷ целое`,
    ),
  };
}

/** Календарный промежуток в днях: лист трассы с пояснением «от … до …» (даты — в `note`, трасса хранит число). */
export function dayCount(key: string, days: number, note: string): Calc<number> {
  return node(key, days, { note });
}
