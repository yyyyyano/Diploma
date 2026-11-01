// Главный экран (DASH-01…04, EXPL-01): одна процедура собирает все числа периода — остатки, доходы и расходы, траты по
// категориям, динамику по месяцам, лимиты и цели, ближайшие регулярные платежи, свободный остаток — и у каждого числа
// отдаёт `traceId` сохранённого расчёта («Откуда эта цифра?»). Деньги считает сервер (@kosht/calc), сайт только рисует.
import { TraceId } from "@kosht/kernel";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { AccountId, AccountKind, CurrencyCode } from "../accounts/accounts.contract.ts";
import { BudgetGoal, BudgetLimit } from "../budgets/budgets.contract.ts";
import { LocalDate, Money } from "../common.ts";
import { pickErrors } from "../errors.ts";
import { FreeBalanceReason } from "../fin/fin.contract.ts";
import { RecurringId, RecurringSection } from "../recurring/recurring.contract.ts";
import { FoundDeduction } from "../tax/tax.contract.ts";

/** Число с расчётом: сумма и traceId её трассы. */
export const Amount = z.strictObject({ amount: Money.schema, traceId: TraceId });
export type Amount = z.infer<typeof Amount>;

/** DASH-02: траты по категориям — не больше стольких рядов, остальное — «Остальное». */
export const MAX_CATEGORY_ROWS = 6;
/** Найденных вычетов на главной — не больше: карточка не вытесняет остальное (DASH-02). */
export const MAX_FOUND_ON_HOME = 3;

export const DashboardPeriod = z
  .strictObject({ from: LocalDate.schema, to: LocalDate.schema })
  .refine((period) => period.from <= period.to, { message: "from позже to" });
export type DashboardPeriod = z.infer<typeof DashboardPeriod>;

export const DashboardAccount = z.strictObject({
  id: AccountId,
  kind: AccountKind,
  name: z.string().nullable(),
  bank: z.string().nullable(),
  mask: z.string().nullable(),
  currency: CurrencyCode,
  /** Остаток в валюте счёта. */
  balance: Money.schema,
  /** Эквивалент в BYN; нет курса НБРБ — null («нет курса», не 0). */
  balanceInByn: Money.schema.nullable(),
  traceId: TraceId.nullable(),
});

export const DashboardCategory = z.strictObject({
  /** Ключ категории: `system:<код>` / `custom:<id>` — он же параметр `category` экрана «Операции». */
  key: z.string(),
  amount: Money.schema,
  traceId: TraceId,
});

export const DashboardMonth = z.strictObject({
  /** «ГГГГ-ММ». */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  income: Amount,
  expense: Amount,
});

export const DashboardUpcoming = z.strictObject({
  id: RecurringId,
  name: z.string(),
  section: RecurringSection,
  on: LocalDate.schema,
  amount: Money.schema,
});

export const DashboardOverview = z.strictObject({
  period: DashboardPeriod,
  today: LocalDate.schema,
  /** Есть ли что показывать: операции, лимиты или цели; нет — «первые шаги» вместо пустых графиков (DASH-04). */
  hasData: z.boolean(),
  income: Amount,
  expense: Amount,
  /** Операции периода без курса НБРБ в суммы не вошли. */
  missingRates: z.int().min(0),
  accounts: z.strictObject({
    /** Всего на счетах в BYN; курса хотя бы одной валюты нет или счетов нет — null. */
    total: Amount.nullable(),
    items: z.array(DashboardAccount),
  }),
  categories: z.strictObject({
    rows: z.array(DashboardCategory).max(MAX_CATEGORY_ROWS),
    /** «Остальное»: сумма категорий за пределами крупнейших; их нет — null. */
    other: z
      .strictObject({ amount: Money.schema, traceId: TraceId, count: z.int().min(1) })
      .nullable(),
  }),
  /** Динамика: шесть месяцев, последний — месяц конца периода, по возрастанию. */
  months: z.array(DashboardMonth).max(12),
  /** Дней до конца месяца периода для подписи «осталось … на N дней» у лимитов. */
  daysLeft: z.int().min(0),
  limits: z.array(BudgetLimit),
  goals: z.array(BudgetGoal),
  /** Свободный остаток — всегда за три полных месяца, независимо от периода. */
  freeBalance: z.strictObject({
    amount: Money.schema.nullable(),
    traceId: TraceId.nullable(),
    months: z.int().min(0).max(12),
    window: z.strictObject({ from: LocalDate.schema, to: LocalDate.schema }).nullable(),
    reason: FreeBalanceReason.nullable(),
  }),
  /** Ближайшие регулярные платежи на 30 дней вперёд (не больше пяти). */
  upcoming: z.array(DashboardUpcoming).max(5),
  /** Найденные вычеты (TAX-20, DASH-02): новые и показанные, свежие первыми, не больше трёх — янтарная карточка. */
  foundDeductions: z.array(FoundDeduction).max(MAX_FOUND_ON_HOME),
});
export type DashboardOverview = z.infer<typeof DashboardOverview>;

export const dashboardContract = {
  /** Все числа главного экрана за период; без периода — текущий месяц по часам сервера. */
  overview: oc
    .route({ method: "GET", path: "/dashboard" })
    .input(z.strictObject({ from: LocalDate.schema.optional(), to: LocalDate.schema.optional() }))
    .output(DashboardOverview)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
};
