// Прогноз остатка по дням до конца месяца (FIN-22, AFF): текущие остатки (без накопительных, в BYN по курсу НБРБ) +
// ожидаемые регулярные поступления − ожидаемые регулярные платежи. Остатки — `accounts.balances`, ожидаемые —
// `recurring.upcoming`; счёт без курса не считается нулём — он назван в `unconverted`. Числа — `@kosht/calc`.
import {
  forecastBalances,
  monthEnd,
  sum,
  type Calc,
  type ExpectedPayment,
  type ForecastDay,
} from "@kosht/calc";
import { LocalDate, type Money } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Deps } from "./deps.ts";

export interface Forecast {
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly days: readonly ForecastDay[];
  /** Счета без курса НБРБ: их остатка в прогнозе нет. */
  readonly unconverted: readonly string[];
  readonly missingRates: readonly string[];
}

/** Ожидаемая сумма — лист с ключом показателя (`fin.expectedIncome` / `fin.expectedPayment`) над средней платежа. */
const expected = (key: string, on: LocalDate, amount: Calc<Money>): ExpectedPayment => ({
  on,
  amount: sum(key, [amount]),
});

export function makeForecast(d: Deps) {
  /** Прогноз с сегодня до `to` (по умолчанию — конец месяца). */
  async function forecast(s: ScopedDb, options: { to?: LocalDate } = {}): Promise<Forecast> {
    const from = d.platform.clock.today();
    const to = options.to ?? monthEnd(from);
    const balances = await d.accounts.balances(s);
    const upcoming = await d.recurring.upcoming(s, { from, to });
    const incomes = upcoming
      .filter((item) => item.flow === "income")
      .map((item) => expected("fin.expectedIncome", item.on, item.amount));
    const payments = upcoming
      .filter((item) => item.flow === "expense")
      .map((item) => expected("fin.expectedPayment", item.on, item.amount));
    return {
      from,
      to,
      days: forecastBalances({ from, to, start: balances.available, incomes, payments }),
      unconverted: balances.unconverted,
      missingRates: balances.missingRates,
    };
  }

  return { forecast };
}

export type ForecastScenario = ReturnType<typeof makeForecast>;
