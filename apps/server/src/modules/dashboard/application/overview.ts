// Сборка главного экрана (DASH-01…04, EXPL-01, REC-03, BUD-02): только чтение, пачками. Фасады соседей зовутся
// параллельно на одном `s` без транзакции: два агрегата операций (категории периода и месяцы динамики — по два запроса на
// любое число групп), лимиты и цели (`budgets`), остатки счетов, свободный остаток (`fin`, всегда за три полных месяца
// независимо от периода), ближайшие платежи (`recurring`). Все показываемые числа — `Calc`; их трассы сохраняются двумя
// пачками `explain.saveMany` (повтор — те же traceId, таблица не растёт), сайт получает числа и traceId готовыми (P1, P2).
import { node, sum, totalOf, type Calc } from "@kosht/calc";
import { MAX_CATEGORY_ROWS, MAX_FOUND_ON_HOME, type DashboardOverview } from "@kosht/contract";
import { LocalDate, Money, TraceId, type TraceValue } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { monthOfDay, monthsEndingAt, splitTop } from "../domain/layout.ts";
import type { Deps } from "./deps.ts";

const BYN = "BYN";
const MONTHS = 6;
const UPCOMING_DAYS = 30;
const UPCOMING_MAX = 5;

const zero = (key: string): Calc<Money> => node(key, Money.of(0, BYN));

function addDays(day: LocalDate, days: number): LocalDate {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, date + days));
  return LocalDate.parse(at.toISOString().slice(0, 10));
}

function monthStart(month: string): LocalDate {
  return LocalDate.parse(`${month}-01`);
}

function monthLast(month: string): LocalDate {
  const [year = 0, number = 1] = month.split("-").map(Number);
  return LocalDate.parse(new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10));
}

export function makeOverview(d: Deps) {
  const { clock } = d.platform;

  async function view(
    s: ScopedDb,
    input: { from?: LocalDate | undefined; to?: LocalDate | undefined },
  ): Promise<DashboardOverview> {
    const today = clock.today();
    // Период по умолчанию — текущий месяц по часам сервера (пояс пользователя), а не браузера.
    const from = input.from ?? monthStart(monthOfDay(input.to ?? today));
    const to = input.to ?? (input.from === undefined ? monthLast(monthOfDay(today)) : today);
    if (from > to) throw new AppError("VALIDATION", { reason: "period" });
    const months = monthsEndingAt(monthOfDay(to), MONTHS);
    const firstMonth = months[0] ?? monthOfDay(to);

    const [byCategory, byMonth, budgets, balances, free, upcoming, found] = await Promise.all([
      d.transactions.aggregate(s, { from, to, groupBy: "category" }),
      d.transactions.aggregate(s, {
        from: monthStart(firstMonth),
        to: monthLast(monthOfDay(to)),
        groupBy: "month",
      }),
      d.budgets.overview(s, monthOfDay(to)),
      d.accounts.balances(s),
      d.fin.freeBalance(s),
      d.recurring.upcoming(s, { from: today, to: addDays(today, UPCOMING_DAYS) }),
      d.tax.activeFound(s),
    ]);

    // Категории: до шести рядов, остальное — одной суммой с трассой.
    const { top, rest } = splitTop(
      byCategory.groups.map((group) => ({
        key: group.key,
        minor: group.expense.value.minor,
        expense: group.expense,
      })),
      MAX_CATEGORY_ROWS,
    );
    const other =
      rest.length === 0
        ? null
        : totalOf(
            "dashboard.otherCategories",
            rest.map((g) => g.expense),
          );

    // Динамика: месяцы без операций — нули, чтобы столбцы стояли подряд.
    const monthGroups = new Map(byMonth.groups.map((group) => [group.key, group]));
    const monthCalcs = months.map((month) => ({
      month,
      income: monthGroups.get(month)?.income ?? zero("transactions.income"),
      expense: monthGroups.get(month)?.expense ?? zero("transactions.expense"),
    }));

    // Всего на счетах: сумма эквивалентов в BYN; нет курса хотя бы одного счёта — числа нет, а не неполная сумма.
    const converted = balances.items.flatMap((item) => (item.inByn === null ? [] : [item.inByn]));
    const [firstConverted, ...otherConverted] = converted;
    const total =
      balances.items.length === 0 ||
      converted.length < balances.items.length ||
      firstConverted === undefined
        ? null
        : sum("accounts.total", [firstConverted, ...otherConverted]);

    // Трассы — двумя пачками: числа периода (с его периодом) и остальные.
    const periodCalcs: Calc<TraceValue>[] = [
      byCategory.income,
      byCategory.expense,
      ...top.map((row) => row.expense),
      ...(other === null ? [] : [other]),
    ];
    const otherCalcs: Calc<TraceValue>[] = [
      ...monthCalcs.flatMap((m) => [m.income, m.expense]),
      ...(total === null ? [] : [total]),
      ...converted,
      ...(free.balance === null ? [] : [free.balance]),
    ];
    const [periodIds, otherIds] = await Promise.all([
      d.explain.saveMany(s, periodCalcs, { period: { from, to } }),
      d.explain.saveMany(s, otherCalcs),
    ]);
    const pick = (ids: readonly string[], at: number): TraceId => TraceId.parse(ids[at]);
    let p = 0;
    const incomeTrace = pick(periodIds, p++);
    const expenseTrace = pick(periodIds, p++);
    const categoryTraces = top.map(() => pick(periodIds, p++));
    const otherTrace = other === null ? null : pick(periodIds, p++);
    let o = 0;
    const monthTraces = monthCalcs.map(() => ({
      income: pick(otherIds, o++),
      expense: pick(otherIds, o++),
    }));
    const totalTrace = total === null ? null : pick(otherIds, o++);
    const accountTraces = new Map(
      balances.items.flatMap((item) =>
        item.inByn === null ? [] : [[item.id, pick(otherIds, o++)] as const],
      ),
    );
    const freeTrace = free.balance === null ? null : pick(otherIds, o++);

    return {
      period: { from, to },
      today,
      hasData:
        byMonth.groups.length > 0 ||
        byCategory.groups.length > 0 ||
        budgets.limits.length > 0 ||
        budgets.goals.length > 0,
      income: { amount: byCategory.income.value, traceId: incomeTrace },
      expense: { amount: byCategory.expense.value, traceId: expenseTrace },
      missingRates: byCategory.missingRates,
      accounts: {
        total:
          total === null || totalTrace === null
            ? null
            : { amount: total.value, traceId: totalTrace },
        items: balances.items.map((item) => ({
          id: item.id as DashboardOverview["accounts"]["items"][number]["id"],
          kind: item.kind as DashboardOverview["accounts"]["items"][number]["kind"],
          name: item.name,
          bank: item.bank,
          mask: item.mask,
          currency: item.currency,
          balance: item.balance,
          balanceInByn: item.inByn?.value ?? null,
          traceId: accountTraces.get(item.id) ?? null,
        })),
      },
      categories: {
        rows: top.map((row, index) => ({
          key: row.key,
          amount: row.expense.value,
          traceId: categoryTraces[index] ?? incomeTrace,
        })),
        other:
          other === null || otherTrace === null
            ? null
            : { amount: other.value, traceId: otherTrace, count: rest.length },
      },
      months: monthCalcs.map((m, index) => ({
        month: m.month,
        income: { amount: m.income.value, traceId: monthTraces[index]?.income ?? incomeTrace },
        expense: { amount: m.expense.value, traceId: monthTraces[index]?.expense ?? expenseTrace },
      })),
      daysLeft: budgets.daysLeft,
      limits: budgets.limits,
      goals: budgets.goals,
      freeBalance: {
        amount: free.balance?.value ?? null,
        traceId: freeTrace,
        months: free.months,
        window: free.window,
        reason: free.reason,
      },
      // Ближайшие платежи — расходы (зарплата в «платежи» не входит); не больше пяти.
      // Найденные вычеты (TAX-20) — акцентом; суммы «до» уже посчитал калькулятор налогов с traceId, дашборд не пересчитывает.
      foundDeductions: found.slice(0, MAX_FOUND_ON_HOME),
      upcoming: upcoming
        .filter((payment) => payment.flow === "expense")
        .slice(0, UPCOMING_MAX)
        .map((payment) => ({
          id: payment.id as DashboardOverview["upcoming"][number]["id"],
          name: payment.name,
          section: payment.section,
          on: payment.on,
          amount: payment.amount.value,
        })),
    };
  }

  return { view };
}

export type Overview = ReturnType<typeof makeOverview>;
