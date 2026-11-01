// «Могу ли я позволить покупку?» (AFF-01…08): три сценария (сейчас, после следующего дохода, накопить) с прогнозом остатка по
// дням и безопасный платёж по ПДН. Деньги — Money в BYN, все числа считает сервер (@kosht/calc), у каждого показанного числа —
// traceId («Откуда эта цифра?», EXPL-02). Ползунок и быстрые суммы пересчитываются вызовом процедуры, а не на сайте (P1). Тот же
// результат отдают инструменты агента `afford_scenarios` и `safe_loan_payment`. Названий банков и программ в результатах нет (P6).
import { TraceId } from "@kosht/kernel";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { GoalId } from "../budgets/budgets.contract.ts";
import { CalendarType } from "../calendar/calendar.contract.ts";
import { LocalDate, Money } from "../common.ts";
import { pickErrors } from "../errors.ts";

/** Число с расчётом: у каждого показанного числа есть «Откуда эта цифра?». */
export const AffordAmount = z.strictObject({ amount: Money.schema, traceId: TraceId });
export type AffordAmount = z.infer<typeof AffordAmount>;

/** Целое число (месяцы) с расчётом. */
export const AffordCount = z.strictObject({ value: z.int().min(0), traceId: TraceId });

/**
 * Вход «Могу ли я позволить покупку?» (AFF-01): сумма и желаемый день (по умолчанию сегодня). Регулярного дохода нет (AFF-08) —
 * ожидаемый доход в месяц и день его поступления называет человек; без них сценарии «после дохода» и «накопить» недоступны.
 * Агент и сайт передают один и тот же плоский объект.
 */
export const AffordInput = z.strictObject({
  price: Money.schema,
  on: LocalDate.schema.optional(),
  expectedIncome: Money.schema.optional(),
  expectedIncomeOn: LocalDate.schema.optional(),
});
export type AffordInput = z.input<typeof AffordInput>;

export const SCENARIO_KINDS = ["now", "after-income", "save"] as const;
export const ScenarioKind = z.enum(SCENARIO_KINDS);
export type ScenarioKind = z.infer<typeof ScenarioKind>;

/** Почему сценария нет: нет регулярного дохода, мало истории, нечего откладывать, нет ожидаемого поступления. */
export const ScenarioReason = z.enum(["no-income", "no-history", "no-surplus", "no-next-income"]);
export type ScenarioReason = z.infer<typeof ScenarioReason>;

/** AFF-04: просадка — с какого дня остаток ниже нуля, в какой день он самый низкий и сколько не хватает до нуля. */
export const ScenarioRisk = z.strictObject({
  firstOn: LocalDate.schema,
  lowestOn: LocalDate.schema,
  shortfall: AffordAmount,
});

/** AFF-03: цель, из накоплений которой закрывается нехватка, и на сколько месяцев она из-за этого сдвинется. */
export const ScenarioGoal = z.strictObject({
  id: GoalId,
  name: z.string().max(60),
  taken: Money.schema,
  shiftMonths: AffordCount,
});

export const AffordScenario = z.strictObject({
  kind: ScenarioKind,
  status: z.enum(["ok", "unavailable"]),
  reason: ScenarioReason.nullable(),
  /** День покупки: «сейчас» — желаемый день, «после дохода» — день поступления; у «накопить» — null. */
  on: LocalDate.schema.nullable(),
  /** Наименьший остаток за период и его день; у «накопить» — null. */
  lowest: z.strictObject({ amount: AffordAmount, on: LocalDate.schema }).nullable(),
  risk: ScenarioRisk.nullable(),
  /** Есть нехватка и цель, накопленного в которой хватает её закрыть; иначе null. */
  goal: ScenarioGoal.nullable(),
  /** Нехватка есть, но накоплений ни в одной цели не хватает: «без минуса не получится». */
  goalUncovered: z.boolean(),
  /** «Накопить»: сколько откладывать в месяц, за сколько месяцев наберётся сумма и к какому дню. */
  saving: z
    .strictObject({
      monthly: AffordAmount,
      months: AffordCount.nullable(),
      readyOn: LocalDate.schema.nullable(),
    })
    .nullable(),
  /** «Рекомендуемо по расчёту»: первый по порядку сценарий без риска. */
  recommended: z.boolean(),
});
export type AffordScenario = z.infer<typeof AffordScenario>;

/** Что учтено в расчёте (AFF-02) — строка «Учтено» на экране. */
export const AffordConsidered = z.strictObject({
  /** На картах и наличных (без накопительных счетов). */
  available: AffordAmount,
  /** Обычные траты в день (текущий уровень жизни); нет истории — null. */
  dailySpend: AffordAmount.nullable(),
  monthlyIncome: AffordAmount.nullable(),
  monthlyObligations: AffordAmount.nullable(),
  /** Счета без курса НБРБ: их остатка в расчёте нет. */
  unconverted: z.array(z.string().max(64)).max(20),
});

/** Событие календаря в окне без суммы (налог придёт в извещении): в сценарии не учтено, человеку об этом сказано. */
export const AffordUnpriced = z.strictObject({
  type: CalendarType,
  rule: z.string().max(40).nullable(),
  on: LocalDate.schema,
});

/** Прогноз остатка по дням для графика: целые копейки BYN, по одному числу на день с `from`. */
export const AffordChart = z.strictObject({
  from: LocalDate.schema,
  baseline: z.array(z.int()).max(400),
  now: z.array(z.int()).max(400),
  afterIncome: z.array(z.int()).max(400).nullable(),
  /** Месячные обязательные платежи: пунктир на графике. */
  obligationsMonthly: Money.schema.nullable(),
});

export const AffordResult = z.strictObject({
  today: LocalDate.schema,
  price: Money.schema,
  purchaseOn: LocalDate.schema,
  horizon: z.strictObject({ from: LocalDate.schema, to: LocalDate.schema }),
  /** «Оценка по вашим данным»: нет регулярного дохода или история короче трёх месяцев (AFF-08). */
  estimate: z.boolean(),
  /** Чего не хватает для всех сценариев: ожидаемого дохода и дня поступления (AFF-08) — агент дозапрашивает. */
  needs: z.array(z.enum(["income"])).max(1),
  considered: AffordConsidered,
  unpriced: z.array(AffordUnpriced).max(20),
  scenarios: z.array(AffordScenario).length(3),
  chart: AffordChart,
});
export type AffordResult = z.infer<typeof AffordResult>;

/**
 * Вход безопасного платежа (AFF-05, AFF-06): тип кредита (предел 40 % или 50 % для белорусских товаров, кроме автомобилей) и,
 * если человек назвал, ставка (сотые доли процента годовых, 14 % = 1400) и срок в месяцах — тогда считается сумма кредита.
 * Доход «на руки» в месяц — из выписок; если регулярного дохода нет, его называет человек.
 */
export const SafeLoanInput = z.strictObject({
  domesticGoods: z.boolean().optional(),
  rateBp: z.int().min(0).max(10_000).optional(),
  months: z.int().min(1).max(600).optional(),
  income: Money.schema.optional(),
});
export type SafeLoanInput = z.input<typeof SafeLoanInput>;

export const SafeLoanResult = z.strictObject({
  /** `no-limit` — предел ПДН ещё не подтверждён в таблице ставок: числа нет, нулём не подменяем; `no-income` — доход не известен. */
  status: z.enum(["ok", "no-limit", "no-income"]),
  domesticGoods: z.boolean(),
  /** Предел в процентах (40 или 50); не подтверждён — null. */
  limitPercent: z.int().min(1).max(100).nullable(),
  /** Параметры таблицы без подтверждённого значения (для `no-limit`). */
  missing: z.array(z.string().max(64)).max(4),
  /** Доход «на руки» в месяц — всегда оценка: банк считает ПДН по своей методике (AFF-06). */
  income: AffordAmount.nullable(),
  incomeSource: z.enum(["history", "user"]).nullable(),
  /** Платежи по кредитам сейчас, суммой — без банков и программ (P6). */
  currentPayments: AffordAmount.nullable(),
  limitAmount: AffordAmount.nullable(),
  /** Новый платёж — до этой суммы в месяц; запаса нет (платежи уже у предела) — null и `exceeded`. */
  safePayment: AffordAmount.nullable(),
  exceeded: z.boolean(),
  /** Наибольшая сумма кредита при названных ставке и сроке. */
  maxLoan: z
    .strictObject({
      amount: AffordAmount,
      rateBp: z.int().min(0).max(10_000),
      months: z.int().min(1).max(600),
    })
    .nullable(),
});
export type SafeLoanResult = z.infer<typeof SafeLoanResult>;

export const affordContract = {
  /** Три сценария покупки на сегодня; ползунок и быстрые суммы вызывают её заново. */
  scenarios: oc
    .route({ method: "POST", path: "/afford/scenarios" })
    .input(AffordInput)
    .output(AffordResult)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
  /** Безопасный платёж по ПДН и (со ставкой и сроком) наибольшая сумма кредита. */
  safeLoan: oc
    .route({ method: "POST", path: "/afford/safe-loan" })
    .input(SafeLoanInput)
    .output(SafeLoanResult)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
};
