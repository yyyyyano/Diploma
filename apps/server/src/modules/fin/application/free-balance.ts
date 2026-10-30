// Свободный остаток (FIN-20, FIN-21, EXPL-01, PROF-03): средний регулярный доход «на руки» минус средние обязательные
// платежи за последние полные месяцы истории (не больше трёх; «по данным за N мес.»). Платежи берутся из `recurring`
// (раздел и состояние решают, что входит, REC-04); среднее каждого — по его повторам внутри окна месяцев, нет повторов в
// окне (годовой платёж) — средняя за все повторы. Числа — только `@kosht/calc`, у каждого — трасса с операциями-основаниями.
import {
  freeBalanceForMonths,
  historyMonths,
  historyWindow,
  monthlyAmount,
  monthlyTotal,
  recurringAverage,
  type Calc,
  type NonEmpty,
} from "@kosht/calc";
import { FreeBalance, type FreeBalanceReason, type ObligationGroup } from "@kosht/contract";
import { LocalDate, Money, TraceId } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { RecurringEntry } from "../../recurring/index.ts";
import { GROUP_ORDER, GROUP_TRACE_KEY, groupOf } from "../domain/groups.ts";
import type { Deps } from "./deps.ts";

/** Расчёт со всеми числами `Calc` — для соседей (`budgets`, `afford`, `dashboard`, `weekly`) и инструмента агента. */
export interface FreeBalanceCalc {
  readonly onDate: LocalDate;
  readonly months: number;
  readonly window: { readonly from: LocalDate; readonly to: LocalDate } | null;
  readonly balance: Calc<Money> | null;
  readonly reason: FreeBalanceReason | null;
  /** Средний регулярный доход в месяц; доходов нет — `null`. */
  readonly income: Calc<Money> | null;
  readonly obligations: readonly {
    readonly group: ObligationGroup;
    readonly amount: Calc<Money>;
  }[];
}

const ZERO = Money.of(0, "BYN");

/** Сумма платежа в месяц за окно: среднее его повторов внутри окна, иначе — его обычная средняя. */
function monthlyInWindow(
  entry: RecurringEntry,
  window: { from: LocalDate; to: LocalDate } | null,
): Calc<Money> {
  if (window === null) return entry.monthly;
  const inside = entry.occurrences.filter((o) => o.on >= window.from && o.on <= window.to);
  const [first, ...rest] = inside;
  if (first === undefined) return entry.monthly;
  const list: NonEmpty<{ id: string; amount: Money }> = [first, ...rest];
  return monthlyAmount(recurringAverage(list), entry.period);
}

export function makeFreeBalance(d: Deps) {
  const { clock } = d.platform;

  async function calculate(s: ScopedDb): Promise<FreeBalanceCalc> {
    const onDate = clock.today();
    const first = await d.transactions.firstOperationOn(s);
    const months = historyMonths(first ?? null, onDate);
    const window = months === 0 ? null : historyWindow(onDate, months);
    const entries = (await d.recurring.list(s, { onDate })).filter((entry) => entry.counted);
    const incomes = entries.filter((entry) => entry.section === "income");
    const income =
      incomes.length === 0
        ? null
        : monthlyTotal(
            "fin.averageIncome",
            incomes.map((entry) => monthlyInWindow(entry, window)),
          );
    const obligations = GROUP_ORDER.flatMap((group) => {
      const parts = entries
        .filter((entry) => entry.section !== "income")
        .filter((entry) => groupOf(entry.section, entry.categoryCode) === group)
        .map((entry) => monthlyInWindow(entry, window));
      return parts.length === 0
        ? []
        : [{ group, amount: monthlyTotal(GROUP_TRACE_KEY[group], parts) }];
    });
    if (months === 0) {
      return {
        onDate,
        months,
        window,
        balance: null,
        reason: "insufficient-history",
        income,
        obligations,
      };
    }
    if (income === null) {
      // Без регулярного дохода «доход − платежи» был бы просто минусом платежей: это не свободный остаток.
      return {
        onDate,
        months,
        window,
        balance: null,
        reason: "no-regular-income",
        income,
        obligations,
      };
    }
    const result = freeBalanceForMonths(months, {
      averageIncome: income,
      averageObligations: obligations.map((row) => row.amount),
    });
    return { onDate, months, window, balance: result.balance, reason: null, income, obligations };
  }

  /** Для сайта: те же числа с traceId — расчёты сохраняются пачкой (повтор не плодит строки, EXPL-02). */
  async function view(s: ScopedDb): Promise<FreeBalance> {
    const result = await calculate(s);
    const calcs: Calc<Money>[] = [
      ...(result.balance === null ? [] : [result.balance]),
      ...(result.income === null ? [] : [result.income]),
      ...result.obligations.map((row) => row.amount),
    ];
    const ids = await d.explain.saveMany(
      s,
      calcs,
      result.window === null ? {} : { period: result.window },
    );
    let at = 0;
    const next = () => TraceId.parse(ids[at++]);
    const balanceTrace = result.balance === null ? null : next();
    const incomeTrace = result.income === null ? null : next();
    return {
      onDate: result.onDate,
      months: result.months,
      window: result.window,
      freeBalance: result.balance?.value ?? null,
      freeBalanceTraceId: balanceTrace,
      reason: result.reason,
      income: result.income?.value ?? ZERO,
      incomeTraceId: incomeTrace,
      obligations: result.obligations.map((row) => ({
        group: row.group,
        amount: row.amount.value,
        traceId: next(),
      })),
    };
  }

  /**
   * PROF-03: факт-предположение «свободный остаток» в профиле; повтор без изменений ничего не пишет. Нет числа
   * (мало истории, нет дохода) — факта нет; подтверждённое человеком не перетирается (`upsertDerivedFact`).
   */
  async function syncFact(s: ScopedDb): Promise<void> {
    const result = await calculate(s);
    if (result.balance === null) return;
    const amount = result.balance.value;
    const [existing] = await d.profile.getFacts(s, ["finance.freeBalance"], result.onDate);
    if (
      existing?.value.key === "finance.freeBalance" &&
      existing.value.amount.minor === amount.minor &&
      existing.value.months === result.months
    ) {
      return;
    }
    await d.profile.upsertDerivedFact(s, {
      value: { key: "finance.freeBalance", amount, months: result.months },
      source: "system",
      sourceRef: "fin",
    });
  }

  return { calculate, view, syncFact };
}

export type FreeBalanceScenario = ReturnType<typeof makeFreeBalance>;
