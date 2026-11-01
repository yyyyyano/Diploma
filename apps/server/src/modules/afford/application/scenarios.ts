// «Могу ли я позволить покупку?» (AFF-01…08): три сценария — купить сейчас, после следующего дохода, накопить. Данные берутся
// у соседей (AFF-02): остатки (`accounts`), прогноз регулярных платежей и поступлений (`fin.forecast`), события календаря с суммой
// (`calendar.range`, только хранимые — регулярные платежи уже в прогнозе, дважды не считаются), обычные траты (`transactions`),
// доход и обязательные платежи (`fin.freeBalance`), цели (`budgets`). Числа считает `@kosht/calc`; каждое показываемое число
// сохраняется для «Откуда эта цифра?». Горизонт — настройка. Просадка — остаток ниже нуля (AFF-04): прогноз уже вычитает
// ближайшие обязательные платежи, поэтому «ниже суммы обязательных платежей» и «ниже нуля» — одно событие (R65).
import {
  avg,
  FREE_BALANCE_MONTHS,
  firstBelowZero,
  lowestBalance,
  monthsToCover,
  node,
  savingsPlan,
  scaleMoney,
  scenarioBalances,
  shortfall,
  sub,
  sum,
  type Calc,
} from "@kosht/calc";
import type {
  AffordInput,
  AffordResult,
  AffordScenario,
  CalendarEntry,
  GoalId,
  ScenarioReason,
} from "@kosht/contract";
import { LocalDate, Money, TraceId, type TraceValue } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { addMonths, monthlyDays } from "../domain/dates.ts";
import { pickGoal } from "../domain/goals.ts";
import { AFFORD_HORIZON_DAYS } from "../settings.ts";
import type { Deps } from "./deps.ts";

const BYN = "BYN";
const HALF_UP = { rounding: "half-up-kopeck" } as const;
const zero = (key: string, note: string): Calc<Money> => node(key, Money.of(0, BYN), { note });

/** Событие календаря, уже учтённое прогнозом `fin`, повторно не считается: берутся только хранимые события с днём и суммой. */
function storedWithAmount(entries: readonly CalendarEntry[]) {
  return entries.filter(
    (entry) =>
      entry.stored &&
      entry.on !== null &&
      entry.amount !== null &&
      entry.direction !== null &&
      entry.amount.currency === BYN,
  );
}

/** Налоги и страховки без суммы (придут в извещении): в сценарии не учтены — человеку об этом говорится. */
function unpricedOf(entries: readonly CalendarEntry[]): AffordResult["unpriced"] {
  return entries.flatMap((entry) =>
    entry.stored &&
    entry.on !== null &&
    entry.amount === null &&
    (entry.type === "tax" || entry.type === "insurance")
      ? [{ type: entry.type, rule: entry.rule, on: entry.on }]
      : [],
  );
}

export function makeScenarios(d: Deps) {
  return async function scenarios(s: ScopedDb, input: AffordInput): Promise<AffordResult> {
    const today = d.platform.clock.today();
    const horizonDays = await d.platform.settings.get(AFFORD_HORIZON_DAYS);
    const to = LocalDate.addDays(today, horizonDays);

    // Вход: сумма в BYN; день — от сегодня до конца горизонта; ожидаемый доход — суммой и днём вместе (AFF-08).
    if (input.price.currency !== BYN || input.price.minor <= 0) {
      throw new AppError("VALIDATION", { field: "price" });
    }
    const purchaseOn = input.on ?? today;
    if (purchaseOn < today || purchaseOn > to) throw new AppError("VALIDATION", { field: "on" });
    if ((input.expectedIncome === undefined) !== (input.expectedIncomeOn === undefined)) {
      throw new AppError("VALIDATION", {
        field: input.expectedIncome === undefined ? "expectedIncome" : "expectedIncomeOn",
      });
    }
    if (
      input.expectedIncome !== undefined &&
      (input.expectedIncome.currency !== BYN || input.expectedIncome.minor <= 0)
    ) {
      throw new AppError("VALIDATION", { field: "expectedIncome" });
    }
    if (
      input.expectedIncomeOn !== undefined &&
      (input.expectedIncomeOn < today || input.expectedIncomeOn > to)
    ) {
      throw new AppError("VALIDATION", { field: "expectedIncomeOn" });
    }

    const balances = await d.accounts.balances(s);
    const free = await d.fin.freeBalance(s);
    const forecast = await d.fin.forecast(s, { to });
    const upcoming = await d.recurring.upcoming(s, { from: today, to });
    const calendar = await d.calendar.range(s, { from: today, to });
    const budgets = await d.budgets.overview(s);

    // Доход: регулярный (из выписок) или названный человеком (AFF-08); без обоих сценарии «после дохода» и «накопить» недоступны.
    const regularIncome = free.income;
    const userIncome =
      regularIncome === null && input.expectedIncome !== undefined
        ? node("afford.income", input.expectedIncome, { note: "указано вами" })
        : null;
    const monthlyIncome = regularIncome ?? userIncome;
    const needsIncome = monthlyIncome === null;

    // Обязательные платежи и обычные траты в месяц и в день (AFF-02, AFF-03).
    const obligationTerms = free.obligations.map((row) => row.amount);
    const [firstObligation, ...otherObligations] = obligationTerms;
    const obligations: Calc<Money> =
      firstObligation === undefined
        ? zero("afford.obligations", "обязательных регулярных платежей нет")
        : sum("afford.obligations", [firstObligation, ...otherObligations]);
    let discretionary: Calc<Money> | null = null;
    let dailySpend: Calc<Money> | null = null;
    if (free.months > 0 && free.window !== null) {
      const spent = await d.transactions.aggregate(s, {
        from: free.window.from,
        to: free.window.to,
        groupBy: "month",
      });
      const [firstMonth, ...otherMonths] = spent.groups.map((group) => group.expense);
      const expenses =
        firstMonth === undefined
          ? zero("afford.expenses", "расходов за эти месяцы нет")
          : avg("afford.expenses", [firstMonth, ...otherMonths], HALF_UP);
      discretionary =
        expenses.value.minor <= obligations.value.minor
          ? zero("afford.discretionary", "расходы не больше обязательных платежей")
          : sub("afford.discretionary", expenses, [obligations]);
      dailySpend = scaleMoney(
        "afford.dailySpend",
        discretionary,
        node("afford.monthsInYear", 12),
        node("afford.daysInYear", 365),
        HALF_UP,
      );
    }

    // События календаря с суммой и поступления, названные человеком (повторяются раз в месяц до конца горизонта).
    const stored = storedWithAmount(calendar.entries);
    const extraIncomes = [
      ...stored
        .filter((entry) => entry.direction === "in")
        .map((entry) => ({
          on: entry.on as LocalDate,
          amount: node("afford.extraIncome", entry.amount as Money, { note: "событие календаря" }),
        })),
      ...(userIncome === null || input.expectedIncomeOn === undefined
        ? []
        : monthlyDays(input.expectedIncomeOn, to).map((on) => ({ on, amount: userIncome }))),
    ];
    const extraPayments = stored
      .filter((entry) => entry.direction === "out")
      .map((entry) => ({
        on: entry.on as LocalDate,
        amount: node("afford.extraPayment", entry.amount as Money, { note: "событие календаря" }),
      }));

    // День следующего поступления после желаемого дня покупки (AFF-03, сценарий 2).
    const incomeDays = [
      ...upcoming.filter((item) => item.flow === "income").map((item) => item.on),
      ...(userIncome === null
        ? []
        : extraIncomes.filter((i) => i.amount === userIncome).map((i) => i.on)),
    ].toSorted();
    const nextIncomeOn = incomeDays.find((on) => on > purchaseOn) ?? null;

    const price = node("afford.purchase", input.price);
    const run = (purchase: { on: LocalDate; amount: Calc<Money> } | null) =>
      scenarioBalances({
        base: forecast.days,
        incomes: extraIncomes,
        payments: extraPayments,
        dailySpend,
        purchase,
      });
    const baseline = run(null);
    const nowDays = run({ on: purchaseOn, amount: price });
    const afterDays = nextIncomeOn === null ? null : run({ on: nextIncomeOn, amount: price });

    // Числа, которые получат traceId («Откуда эта цифра?»): порядок записи = порядок получения id.
    const calcs: Calc<TraceValue>[] = [];
    const slot = (calc: Calc<TraceValue> | null): number =>
      calc === null ? -1 : calcs.push(calc) - 1;
    const slots = {
      available: slot(balances.available),
      dailySpend: slot(dailySpend),
      monthlyIncome: slot(monthlyIncome),
      obligations: slot(free.obligations.length > 0 ? obligations : null),
    };

    const goals = budgets.goals;
    interface Built {
      readonly scenario: Omit<
        AffordScenario,
        "recommended" | "lowest" | "risk" | "goal" | "saving"
      >;
      readonly lowest: { calc: Calc<Money>; on: LocalDate; slot: number } | null;
      readonly risk: {
        firstOn: LocalDate;
        lowestOn: LocalDate;
        shortfall: Calc<Money>;
        slot: number;
      } | null;
      readonly goal: {
        id: string;
        name: string;
        taken: Money;
        shift: Calc<number>;
        slot: number;
      } | null;
      readonly saving: {
        monthly: Calc<Money>;
        months: Calc<number> | null;
        slots: [number, number];
      } | null;
    }

    function purchaseScenario(
      kind: "now" | "after-income",
      on: LocalDate | null,
      days: ReturnType<typeof run> | null,
      reason: ScenarioReason | null,
    ): Built {
      const base = { kind, on, saving: null, goalUncovered: false } as const;
      if (days === null || on === null) {
        return {
          scenario: { ...base, status: "unavailable", reason },
          lowest: null,
          risk: null,
          goal: null,
          saving: null,
        };
      }
      const low = lowestBalance(days);
      const lacks = shortfall(low.balance);
      const firstOn = firstBelowZero(days);
      const lowest = { calc: low.balance, on: low.on, slot: slot(low.balance) };
      if (lacks === null || firstOn === null) {
        return {
          scenario: { ...base, status: "ok", reason: null },
          lowest,
          risk: null,
          goal: null,
          saving: null,
        };
      }
      const risk = { firstOn, lowestOn: low.on, shortfall: lacks, slot: slot(lacks) };
      const picked = pickGoal(lacks.value.minor, goals);
      if (picked === null || picked.contribution === null) {
        return {
          scenario: { ...base, status: "ok", reason: null, goalUncovered: true },
          lowest,
          risk,
          goal: null,
          saving: null,
        };
      }
      const shift = monthsToCover(
        "afford.goalShift",
        lacks,
        node("afford.goalContribution", picked.contribution, { note: "рекомендуемый взнос цели" }),
      );
      return {
        scenario: { ...base, status: "ok", reason: null },
        lowest,
        risk,
        goal: { id: picked.id, name: picked.name, taken: lacks.value, shift, slot: slot(shift) },
        saving: null,
      };
    }

    // «Накопить»: доход − обязательные платежи − обычные траты, сумма делится на остаток в месяц.
    function saveScenario(): Built {
      const base = {
        kind: "save",
        on: null,
        goalUncovered: false,
      } as const;
      const unavailable = (reason: ScenarioReason): Built => ({
        scenario: { ...base, status: "unavailable", reason },
        lowest: null,
        risk: null,
        goal: null,
        saving: null,
      });
      if (monthlyIncome === null) return unavailable("no-income");
      if (discretionary === null) return unavailable("no-history");
      const plan = savingsPlan({ income: monthlyIncome, obligations, discretionary, price });
      const monthlySlot = slot(plan.monthly);
      const monthsSlot = slot(plan.months);
      return {
        scenario: {
          ...base,
          status: plan.months === null ? "unavailable" : "ok",
          reason: plan.months === null ? "no-surplus" : null,
        },
        lowest: null,
        risk: null,
        goal: null,
        saving: { monthly: plan.monthly, months: plan.months, slots: [monthlySlot, monthsSlot] },
      };
    }

    const built: Built[] = [
      purchaseScenario("now", purchaseOn, nowDays, null),
      purchaseScenario(
        "after-income",
        nextIncomeOn,
        afterDays,
        needsIncome ? "no-income" : "no-next-income",
      ),
      saveScenario(),
    ];

    const ids = await d.explain.saveMany(s, calcs, { period: { from: today, to } });
    const idAt = (index: number): TraceId => {
      const id = ids[index];
      if (id === undefined) throw new Error("afford.explain: нет traceId для числа результата");
      return TraceId.parse(id);
    };
    const amount = (calc: Calc<Money>, index: number) => ({
      amount: calc.value,
      traceId: idAt(index),
    });

    // Рекомендуемый — первый по порядку сценарий без риска (у «накопить» — тот, где срок найден).
    const recommendedAt = built.findIndex((item) =>
      item.scenario.kind === "save"
        ? item.saving?.months !== null && item.saving?.months !== undefined
        : item.scenario.status === "ok" && item.risk === null,
    );

    const scenariosOut: AffordScenario[] = built.map((item, index) => ({
      ...item.scenario,
      lowest:
        item.lowest === null
          ? null
          : { amount: amount(item.lowest.calc, item.lowest.slot), on: item.lowest.on },
      risk:
        item.risk === null
          ? null
          : {
              firstOn: item.risk.firstOn,
              lowestOn: item.risk.lowestOn,
              shortfall: amount(item.risk.shortfall, item.risk.slot),
            },
      goal:
        item.goal === null
          ? null
          : {
              id: item.goal.id as GoalId,
              name: item.goal.name,
              taken: item.goal.taken,
              shiftMonths: { value: item.goal.shift.value, traceId: idAt(item.goal.slot) },
            },
      saving:
        item.saving === null
          ? null
          : {
              monthly: amount(item.saving.monthly, item.saving.slots[0]),
              months:
                item.saving.months === null
                  ? null
                  : { value: item.saving.months.value, traceId: idAt(item.saving.slots[1]) },
              readyOn:
                item.saving.months === null ? null : addMonths(today, item.saving.months.value),
            },
      recommended: index === recommendedAt,
    }));

    const minors = (days: readonly { balance: Calc<Money> }[]) =>
      days.map((day) => day.balance.value.minor);

    return {
      today,
      price: input.price,
      purchaseOn,
      horizon: { from: today, to },
      // AFF-08: «оценка по вашим данным» — дохода из выписок нет или истории меньше трёх месяцев.
      estimate: regularIncome === null || free.months < FREE_BALANCE_MONTHS,
      needs: needsIncome ? ["income"] : [],
      considered: {
        available: amount(balances.available, slots.available),
        dailySpend: dailySpend === null ? null : amount(dailySpend, slots.dailySpend),
        monthlyIncome: monthlyIncome === null ? null : amount(monthlyIncome, slots.monthlyIncome),
        monthlyObligations:
          free.obligations.length === 0 ? null : amount(obligations, slots.obligations),
        unconverted: [...balances.unconverted],
      },
      unpriced: unpricedOf(calendar.entries),
      scenarios: scenariosOut,
      chart: {
        from: today,
        baseline: minors(baseline),
        now: minors(nowDays),
        afterIncome: afterDays === null ? null : minors(afterDays),
        obligationsMonthly: free.obligations.length === 0 ? null : obligations.value,
      },
    };
  };
}

export type Scenarios = ReturnType<typeof makeScenarios>;
