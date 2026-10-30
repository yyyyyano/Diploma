// FIN-22: прогноз остатка по дням до конца месяца = текущие остатки + ожидаемые регулярные поступления − ожидаемые
// регулярные платежи. Каждый день — своё число с трассой: остаток, поступления и платежи, случившиеся к этому дню.
import type { Money } from "@kosht/kernel";
import { LocalDate } from "@kosht/kernel";
import type { Calc } from "../calc.ts";
import { sub, sum, type NonEmpty } from "../money-ops.ts";

export interface ExpectedPayment {
  /** Ожидаемый день; ключ узла — `fin.expectedIncome` или `fin.expectedPayment`. */
  readonly on: LocalDate;
  readonly amount: Calc<Money>;
}

export interface ForecastDay {
  readonly on: LocalDate;
  readonly balance: Calc<Money>;
}

/** Дни от `from` до `to` включительно (сегодня — тоже: остаток на конец сегодняшнего дня). */
function daysBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  const days: LocalDate[] = [];
  let [year = 0, month = 1, day = 1] = from.split("-").map(Number);
  const [toYear = 0, toMonth = 1, toDay = 1] = to.split("-").map(Number);
  const stop = Date.UTC(toYear, toMonth - 1, toDay);
  for (let at = Date.UTC(year, month - 1, day); at <= stop; at += 86_400_000) {
    const d = new Date(at);
    year = d.getUTCFullYear();
    month = d.getUTCMonth() + 1;
    day = d.getUTCDate();
    days.push(
      LocalDate.parse(
        `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      ),
    );
  }
  return days;
}

/**
 * Остаток на конец каждого дня `from…to`: стартовый остаток (на начало `from`) плюс поступления и минус платежи, дата
 * которых не позже этого дня. Ожидаемые за `from…to` — во входе (регулярные, `recurring.upcoming`).
 */
export function forecastBalances(input: {
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly start: Calc<Money>;
  readonly incomes: readonly ExpectedPayment[];
  readonly payments: readonly ExpectedPayment[];
}): ForecastDay[] {
  return daysBetween(input.from, input.to).map((on) => {
    const received = input.incomes.filter((item) => item.on <= on).map((item) => item.amount);
    const paid = input.payments.filter((item) => item.on <= on).map((item) => item.amount);
    const base: NonEmpty<Calc<Money>> = [input.start, ...received];
    const upTo = received.length === 0 ? input.start : sum("fin.forecastBalance", base);
    return { on, balance: sub("fin.forecastBalance", upTo, paid) };
  });
}
