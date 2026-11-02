// Числа итогов недели (WEEK-02, P1): траты прошлой недели, сравнение со средним за предыдущие недели, самые затратные категории,
// израсходованные лимиты, платежи и события ближайших семи дней, найденные вычеты. Считают `transactions`, `budgets`, `calendar`
// и `@kosht/calc` — здесь они только собираются; каждое показываемое число сохраняется для «Откуда эта цифра?» (EXPL-02).
// Нет операций до конца недели — сводки нет (`null`): считать не за что.
import { deviationPercent, weeklyAverage, weeksNode, type Calc } from "@kosht/calc";
import { WEEKLY_TOP, WEEKLY_UPCOMING_ITEMS } from "@kosht/contract";
import { resources } from "@kosht/i18n";
import { LocalDate, Money, TraceId, type TraceValue } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { UPCOMING_DAYS, type WeeklyFacts } from "../domain/template.ts";
import { AVERAGE_WEEKS } from "../settings.ts";
import type { Deps } from "./deps.ts";

/** Порог «лимит почти исчерпан» — как уведомление о лимите (BUD-03). */
const LIMIT_WARN_PERCENT = 80;

export function makeFacts(d: Deps) {
  /** Названия категорий по ключу `system:<код>` / `custom:<id>`: встроенные — из словаря, свои — как назвал человек. */
  async function categoryNames(s: ScopedDb): Promise<ReadonlyMap<string, string>> {
    const names = new Map<string, string>();
    const system = resources.ru.categories.system as Readonly<Record<string, string>>;
    for (const item of (await d.categories.list(s)).items) {
      if (item.ref.type === "system") {
        names.set(`system:${item.ref.code}`, system[item.ref.code] ?? item.ref.code);
      } else {
        names.set(`custom:${item.ref.id}`, item.name ?? "");
      }
    }
    return names;
  }

  /**
   * Сводка за неделю `weekStart…weekEnd` на день `today`; `null` — до конца этой недели операций не было. `limitsMonth` —
   * месяц лимитов «ГГГГ-ММ»; нет — текущий. `forecast: false` — история (DEMO-01): без «ближайших платежей» и найденных вычетов:
   * они зависят от фоновых расчётов соседей (регулярные платежи, поиск вычетов), а история должна быть воспроизводимой.
   */
  async function build(
    s: ScopedDb,
    week: { readonly weekStart: LocalDate; readonly weekEnd: LocalDate },
    today: LocalDate,
    options: { readonly limitsMonth?: string; readonly forecast?: boolean } = {},
  ): Promise<WeeklyFacts | null> {
    const first = await d.transactions.firstOperationOn(s);
    if (first === undefined || first > week.weekEnd) return null;

    // Среднее — по полным неделям до этой, не больше `weekly.average-weeks`; истории меньше недели — сравнения нет.
    const maxWeeks = await d.platform.settings.get(AVERAGE_WEEKS);
    const available = Math.floor(LocalDate.daysBetween(LocalDate.parse(first), week.weekStart) / 7);
    const weeksUsed = Math.max(0, Math.min(maxWeeks, available));

    const spentWeek = await d.transactions.aggregate(s, {
      from: week.weekStart,
      to: week.weekEnd,
      groupBy: "category",
    });
    let average: Calc<Money> | null = null;
    if (weeksUsed > 0) {
      const before = await d.transactions.aggregate(s, {
        from: LocalDate.addDays(week.weekStart, -7 * weeksUsed),
        to: LocalDate.addDays(week.weekStart, -1),
        groupBy: "month",
      });
      average = weeklyAverage(before.expense, weeksNode(weeksUsed));
    }
    const deviation = average === null ? null : deviationPercent(spentWeek.expense, average);

    const names = await categoryNames(s);
    const nameOf = (key: string) => names.get(key) ?? key;
    const top = spentWeek.groups
      .filter((group) => group.expense.value.minor > 0)
      .toSorted(
        (a, b) => b.expense.value.minor - a.expense.value.minor || a.key.localeCompare(b.key),
      )
      .slice(0, WEEKLY_TOP);

    const limits = (await d.budgets.overview(s, options.limitsMonth)).limits
      .filter((limit) => limit.percent >= LIMIT_WARN_PERCENT)
      .toSorted((a, b) => b.percent - a.percent || a.categoryKey.localeCompare(b.categoryKey))
      .slice(0, WEEKLY_TOP);

    const forecast = options.forecast !== false;
    const upcoming = forecast
      ? await d.calendar.range(s, {
          from: today,
          to: LocalDate.addDays(today, UPCOMING_DAYS - 1),
        })
      : { entries: [], totals: { payments: null } };
    const items = upcoming.entries
      .filter((entry) => entry.direction === "out" && entry.on !== null)
      .toSorted((a, b) => (a.on ?? "").localeCompare(b.on ?? ""))
      .slice(0, WEEKLY_UPCOMING_ITEMS);
    const found = forecast ? (await d.tax.activeFound(s)).length : 0;

    // Числа, которые получают traceId: порядок записи = порядок получения id.
    const calcs: Calc<TraceValue>[] = [spentWeek.expense];
    if (average !== null) calcs.push(average);
    if (deviation !== null) calcs.push(deviation);
    calcs.push(...top.map((group) => group.expense));
    const ids = await d.explain.saveMany(s, calcs, {
      period: { from: week.weekStart, to: week.weekEnd },
    });
    let at = 0;
    const next = (): TraceId => TraceId.parse(ids[at++]);

    const spent = { amount: spentWeek.expense.value, traceId: next() };
    const averageOut = average === null ? null : { amount: average.value, traceId: next() };
    const deviationOut = deviation === null ? null : { percent: deviation.value, traceId: next() };
    return {
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      spent,
      average: averageOut,
      deviation: deviationOut,
      weeksUsed,
      categories: top.map((group) => ({
        key: group.key,
        name: nameOf(group.key),
        amount: { amount: group.expense.value, traceId: next() },
      })),
      limits: limits.map((limit) => ({
        name: nameOf(limit.categoryKey),
        percent: limit.percent,
        limit: limit.limit,
        traceId: limit.traceId,
      })),
      upcoming: {
        from: today,
        to: LocalDate.addDays(today, UPCOMING_DAYS - 1),
        payments:
          upcoming.totals.payments === null
            ? null
            : {
                amount: upcoming.totals.payments.amount,
                traceId: upcoming.totals.payments.traceId,
              },
        items: items.map((entry) => ({
          title: entry.title,
          on: entry.on as LocalDate,
          amount: entry.amount,
        })),
      },
      foundDeductions: found,
    };
  }

  return { build };
}

export type Facts = ReturnType<typeof makeFacts>;
