// AFF-03…05: «Могу ли я позволить покупку?» — чистые функции с трассой. Прогноз остатка по дням (из fin) дополняется покупкой,
// событиями календаря и обычными тратами; находятся минимум и просадка ниже нуля; безопасный платёж по ПДН и максимальная сумма
// кредита (аннуитет) считаются целыми числами на BigInt. Пределы ПДН, ставка и срок приходят узлами: в коде их нет (P1).
// Округление — всегда в сторону осторожности: безопасный платёж и сумма кредита — вниз, срок накопления — вверх.
import { LocalDate, Money } from "@kosht/kernel";
import { node, trace, type Calc } from "../calc.ts";
import type { ExpectedPayment, ForecastDay } from "../fin/forecast.ts";
import { mul, mulRate, sub, sum, type NonEmpty } from "../money-ops.ts";
import { divideRounded, roundingNote } from "../rounding.ts";

const FLOOR = { rounding: "floor-kopeck" } as const;

/** Самый длинный кредит, который считаем: 50 лет (степень BigInt растёт с числом месяцев). */
export const MAX_LOAN_MONTHS = 600;

/** Ставка не выше 100 % годовых (10 000 базисных пунктов) — всё выше похоже на опечатку. */
export const MAX_LOAN_RATE_BP = 10_000;

export interface SafePayment {
  /** Предельный платёж: доход × предел ПДН. */
  readonly limitAmount: Calc<Money>;
  /** Безопасный новый платёж = предел × доход − текущие платежи по кредитам; ноль и меньше — запаса нет. */
  readonly room: Calc<Money>;
}

/**
 * AFF-05: безопасный платёж по ПДН. Доход 3 200, предел 40 %, по кредитам уже 800 → предел 1 280, новый платёж — до 480.
 * Предел округляется вниз до копейки: лучше недообещать, чем завысить. Отрицательное значение — текущие платежи уже выше предела.
 */
export function safePayment(input: {
  readonly income: Calc<Money>;
  readonly limitBp: Calc<number>;
  readonly currentPayments: Calc<Money>;
}): SafePayment {
  if (input.income.value.minor <= 0) {
    throw new RangeError("afford.income: доход для ПДН должен быть больше нуля.");
  }
  if (input.limitBp.value <= 0 || input.limitBp.value > 10_000) {
    throw new RangeError(
      `afford.pdnLimit: предел ПДН — от 1 до 10 000 сотых долей процента, получено ${String(input.limitBp.value)}.`,
    );
  }
  const limitAmount = mulRate("afford.pdnLimitAmount", input.income, input.limitBp, FLOOR);
  return {
    limitAmount,
    room: sub("afford.safePayment", limitAmount, [input.currentPayments]),
  };
}

/** Знаменатель месячной ставки: годовая ставка в базисных пунктах ÷ 12 = bp ÷ (10 000 × 12) от единицы. */
const MONTHLY_BASE = 120_000n;

/**
 * AFF-05: наибольшая сумма кредита при ежемесячном платеже P, годовой ставке и сроке n месяцев (аннуитет):
 * L = P · (1 − (1 + r)^−n) ÷ r, r = ставка ÷ 12; при r = 0 — P · n. Считается точной дробью на BigInt и округляется вниз до копейки.
 */
export function annuityPrincipal(
  payment: Calc<Money>,
  annualRateBp: Calc<number>,
  months: Calc<number>,
): Calc<Money> {
  if (payment.value.minor <= 0) {
    throw new RangeError("afford.maxLoan: платёж должен быть больше нуля.");
  }
  if (!Number.isInteger(months.value) || months.value < 1 || months.value > MAX_LOAN_MONTHS) {
    throw new RangeError(
      `afford.term: срок — от 1 до ${String(MAX_LOAN_MONTHS)} месяцев, получено ${String(months.value)}.`,
    );
  }
  if (
    !Number.isInteger(annualRateBp.value) ||
    annualRateBp.value < 0 ||
    annualRateBp.value > MAX_LOAN_RATE_BP
  ) {
    throw new RangeError(
      `afford.rate: ставка — от 0 до ${String(MAX_LOAN_RATE_BP)} сотых долей процента, получено ${String(annualRateBp.value)}.`,
    );
  }
  const p = BigInt(payment.value.minor);
  const n = BigInt(months.value);
  const rate = BigInt(annualRateBp.value);
  let minor: bigint;
  if (rate === 0n) {
    minor = p * n;
  } else {
    const grown = (MONTHLY_BASE + rate) ** n;
    const flat = MONTHLY_BASE ** n;
    minor = divideRounded(p * MONTHLY_BASE * (grown - flat), rate * grown, FLOOR.rounding);
  }
  const value = Money.of(Number(minor), payment.value.currency);
  return {
    value,
    trace: trace(
      "afford.maxLoan",
      "mul",
      value,
      [payment.trace, annualRateBp.trace, months.trace],
      [],
      `аннуитет: платёж × (1 − (1 + r)^−срок) ÷ r, r = ставка ÷ 12; ${roundingNote(FLOOR.rounding)}`,
    ),
  };
}

export interface ScenarioBalancesInput {
  /** Прогноз остатка без покупки (`fin.forecast`): остаток на конец каждого дня с сегодня. */
  readonly base: readonly ForecastDay[];
  /** События календаря с суммой, которых нет среди регулярных платежей: поступления и платежи. */
  readonly incomes: readonly ExpectedPayment[];
  readonly payments: readonly ExpectedPayment[];
  /** Обычные траты в день (текущий уровень жизни); `null` — нет данных, траты не учитываются. */
  readonly dailySpend: Calc<Money> | null;
  readonly purchase: { readonly on: LocalDate; readonly amount: Calc<Money> } | null;
}

/**
 * AFF-03: остаток на конец каждого дня сценария = прогноз без покупки + поступления календаря − платежи календаря − обычные
 * траты (за дни после сегодняшнего) − покупка (со дня покупки). Нечего добавлять — остаток дня берётся из прогноза как есть.
 */
export function scenarioBalances(input: ScenarioBalancesInput): ForecastDay[] {
  return input.base.map((day, index) => {
    const received = input.incomes.filter((item) => item.on <= day.on).map((item) => item.amount);
    const outgoing = input.payments.filter((item) => item.on <= day.on).map((item) => item.amount);
    if (input.dailySpend !== null && index > 0) {
      outgoing.push(mul("afford.dailySpendTotal", input.dailySpend, node("afford.days", index)));
    }
    if (input.purchase !== null && input.purchase.on <= day.on)
      outgoing.push(input.purchase.amount);
    if (received.length === 0 && outgoing.length === 0) return day;
    const base: NonEmpty<Calc<Money>> = [day.balance, ...received];
    const upTo = received.length === 0 ? day.balance : sum("afford.balance", base);
    return { on: day.on, balance: sub("afford.balance", upTo, outgoing) };
  });
}

export interface LowestBalance {
  readonly on: LocalDate;
  readonly balance: Calc<Money>;
}

/** Наименьший остаток за период и его день (при равенстве — ранний день). Пустой период — ошибка вызывающего. */
export function lowestBalance(days: readonly ForecastDay[]): LowestBalance {
  const [first, ...rest] = days;
  if (first === undefined) throw new RangeError("afford.minBalance: пустой прогноз.");
  let low = first;
  for (const day of rest) if (day.balance.value.minor < low.balance.value.minor) low = day;
  return {
    on: low.on,
    balance: {
      value: low.balance.value,
      trace: trace(
        "afford.minBalance",
        "value",
        low.balance.value,
        [low.balance.trace],
        [],
        "наименьший остаток за период",
      ),
    },
  };
}

/** AFF-04: первый день, когда остаток ниже нуля; такого дня нет — `null`. */
export function firstBelowZero(days: readonly ForecastDay[]): LocalDate | null {
  return days.find((day) => day.balance.value.minor < 0)?.on ?? null;
}

/** AFF-04: сколько не хватает до нуля в самый низкий день (нужный минимум остатка 0 минус остаток); хватает — `null`. */
export function shortfall(lowest: Calc<Money>): Calc<Money> | null {
  if (lowest.value.minor >= 0) return null;
  return sub("afford.shortfall", node("afford.reserve", Money.of(0, lowest.value.currency)), [
    lowest,
  ]);
}

export interface SavingsPlan {
  /** Сколько можно откладывать в месяц: средний доход − обязательные платежи − обычные траты. */
  readonly monthly: Calc<Money>;
  /** За сколько полных месяцев наберётся сумма; нечего откладывать — `null`. */
  readonly months: Calc<number> | null;
}

/** Целое число месяцев «сумма ÷ в месяц» с округлением вверх: неполный месяц — ещё один. */
export function monthsToCover(
  key: string,
  amount: Calc<Money>,
  perMonth: Calc<Money>,
): Calc<number> {
  Money.sameCurrency([amount.value, perMonth.value]);
  if (amount.value.minor <= 0 || perMonth.value.minor <= 0) {
    throw new RangeError(`${key}: и сумма, и взнос в месяц должны быть больше нуля.`);
  }
  const value = Number(
    divideRounded(BigInt(amount.value.minor), BigInt(perMonth.value.minor), "ceil-kopeck"),
  );
  return {
    value,
    trace: trace(
      key,
      "mul",
      value,
      [amount.trace, perMonth.trace],
      [],
      `сумма ÷ в месяц, вверх до целого месяца; ${roundingNote("ceil-kopeck")}`,
    ),
  };
}

/**
 * AFF-03, сценарий «Накопить»: (средний доход − обязательные платежи − обычные траты) в месяц и через сколько месяцев наберётся
 * сумма покупки. Остаток не положителен — месяцев нет: «при текущих тратах не накопить».
 */
export function savingsPlan(input: {
  readonly income: Calc<Money>;
  readonly obligations: Calc<Money>;
  readonly discretionary: Calc<Money>;
  readonly price: Calc<Money>;
}): SavingsPlan {
  const monthly = sub("afford.monthlySaving", input.income, [
    input.obligations,
    input.discretionary,
  ]);
  if (monthly.value.minor <= 0) return { monthly, months: null };
  return { monthly, months: monthsToCover("afford.monthsToSave", input.price, monthly) };
}
