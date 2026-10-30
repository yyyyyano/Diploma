// Лимиты и цели (BUD-01…07): месячные пределы по категориям с процентом и порогами 80 / 100 %, цели — копилка или
// привязка к накопительному счёту с рекомендуемым взносом. Суммы — Money в BYN, проценты и взносы считает сервер
// (@kosht/calc), «Откуда эта цифра?» — traceId в ответе (сохранённый расчёт, EXPL-02). Изменение — с «Отменить» (P5),
// удаление лимита и цели — только решением «Да/Нет» (AGT-07).
import { TraceId } from "@kosht/kernel";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { DecisionId, UndoToken } from "../actions/actions.contract.ts";
import { AccountId } from "../accounts/accounts.contract.ts";
import { LocalDate, Money } from "../common.ts";
import { pickErrors } from "../errors.ts";

export const LimitId = z.uuid().brand<"LimitId">();
export type LimitId = z.infer<typeof LimitId>;
export const GoalId = z.uuid().brand<"GoalId">();
export type GoalId = z.infer<typeof GoalId>;

/** Категория лимита: `system:<код>` или `custom:<id>` — как ключ группы агрегата операций и параметр «Операций». */
export const CategoryKey = z.string().regex(/^(system:[a-z][a-z0-9-]*|custom:[0-9a-f-]{36})$/);

/** Месяц лимитов: «ГГГГ-ММ». */
export const BudgetMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Пороги уведомлений о лимите (BUD-03) и цели (BUD-07), в процентах. */
export const LIMIT_THRESHOLDS = [80, 100] as const;
export const GOAL_THRESHOLDS = [50, 100] as const;

export const BudgetLimit = z.strictObject({
  id: LimitId,
  categoryKey: CategoryKey,
  limit: Money.schema,
  /** Расходы категории за месяц: покупки минус возвраты (FIN-01). */
  spent: Money.schema,
  /** Сколько осталось до лимита; отрицательное — превышение. */
  remaining: Money.schema,
  /** Процент лимита, вниз до целого; может быть больше 100. */
  percent: z.int().min(0),
  /** Расчёт процента: расходы с операциями-основаниями, лимит и процент («Откуда эта цифра?»). */
  traceId: TraceId,
  notify80: z.boolean(),
  notify100: z.boolean(),
  /** Операции, не вошедшие в расходы (нет курса НБРБ): число; 0 — все учтены. */
  missingRates: z.int().min(0),
});
export type BudgetLimit = z.infer<typeof BudgetLimit>;

export const GoalKind = z.enum(["piggy", "account"]);
export type GoalKind = z.infer<typeof GoalKind>;

export const GoalContribution = z.strictObject({
  id: z.uuid(),
  amount: Money.schema,
  madeOn: LocalDate.schema,
});

export const BudgetGoal = z.strictObject({
  id: GoalId,
  name: z.string(),
  kind: GoalKind,
  target: Money.schema,
  deadline: LocalDate.schema,
  createdOn: LocalDate.schema,
  /** Счёт цели «по счёту»; у копилки — null. */
  accountId: AccountId.nullable(),
  /** Счёт удалён или стал неподходящим — прогресс не известен. */
  accountMissing: z.boolean(),
  /** Накоплено: сумма взносов или остаток счёта в BYN; нет курса счёта — null («нет курса», не 0). */
  saved: Money.schema.nullable(),
  percent: z.int().min(0).nullable(),
  /** Расчёт процента цели; нет накопленного — null. */
  traceId: TraceId.nullable(),
  /** Полных месяцев до срока, не меньше 1. */
  monthsLeft: z.int().min(1),
  /** «Откладывайте по X в месяц» (BUD-05); цель достигнута — 0; накопленное не известно — null. */
  contribution: Money.schema.nullable(),
  contributionTraceId: TraceId.nullable(),
  /** Укладывается ли взнос в свободный остаток; свободного остатка нет («недостаточно данных») — null. */
  fitsFreeBalance: z.boolean().nullable(),
  /** Плановая сумма на сегодня и отставание от графика (BUD-07). */
  planned: Money.schema,
  behind: z.boolean(),
  /** Последние взносы копилки (по убыванию дня); у цели по счёту — пусто. */
  contributions: z.array(GoalContribution).max(20),
});
export type BudgetGoal = z.infer<typeof BudgetGoal>;

export const BudgetsOverview = z.strictObject({
  month: BudgetMonth,
  /** Дней до конца месяца по поясу пользователя (сегодня включительно). */
  daysLeft: z.int().min(0),
  limits: z.array(BudgetLimit),
  goals: z.array(BudgetGoal),
  /** Свободный остаток в месяц для сравнения со взносом; нет — null. */
  freeBalance: Money.schema.nullable(),
  freeBalanceTraceId: TraceId.nullable(),
});
export type BudgetsOverview = z.infer<typeof BudgetsOverview>;

export const OverviewInput = z.strictObject({ month: BudgetMonth.optional() });

const NotifyFlags = {
  notify80: z.boolean().optional(),
  notify100: z.boolean().optional(),
};

/** Новый лимит или правка: у категории один лимит, повторный вызов меняет его. */
export const SetLimitInput = z.strictObject({
  categoryKey: CategoryKey,
  limit: Money.schema,
  ...NotifyFlags,
});

export const CreateGoalInput = z.strictObject({
  name: z.string().trim().min(1).max(60),
  kind: GoalKind,
  target: Money.schema,
  deadline: LocalDate.schema,
  /** Только для цели «по счёту»: накопительный счёт или вклад. */
  accountId: AccountId.optional(),
});

export const UpdateGoalInput = z.strictObject({
  id: GoalId,
  name: z.string().trim().min(1).max(60).optional(),
  target: Money.schema.optional(),
  deadline: LocalDate.schema.optional(),
});

export const ContributeInput = z.strictObject({ goalId: GoalId, amount: Money.schema });

/** Расчёт взноса до создания цели (окно «Новая цель»): без записи, числа те же, что у готовой цели. */
export const PreviewGoalInput = z.strictObject({
  target: Money.schema,
  deadline: LocalDate.schema,
  accountId: AccountId.optional(),
});

export const GoalPreview = z.strictObject({
  monthsLeft: z.int().min(1),
  contribution: Money.schema,
  fitsFreeBalance: z.boolean().nullable(),
  freeBalance: Money.schema.nullable(),
});
export type GoalPreview = z.infer<typeof GoalPreview>;

const LimitChange = z.strictObject({ limit: BudgetLimit, undoToken: UndoToken });
const GoalChange = z.strictObject({ goal: BudgetGoal, undoToken: UndoToken });
const IdOf = <T extends z.ZodType>(id: T) => z.strictObject({ id });
const WriteErrors = pickErrors("UNAUTHORIZED", "VALIDATION", "NOT_FOUND", "CONFLICT");

export const budgetsContract = {
  /** Лимиты месяца с процентом и цели с прогрессом; месяц не указан — текущий по часам сервера. */
  overview: oc
    .route({ method: "GET", path: "/budgets" })
    .input(OverviewInput)
    .output(BudgetsOverview)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
  /** Новый лимит или правка (BUD-01, BUD-06) с «Отменить». */
  setLimit: oc
    .route({ method: "POST", path: "/budgets/limit" })
    .input(SetLimitInput)
    .output(LimitChange)
    .errors(WriteErrors),
  /** Удаление лимита — только решением «Да/Нет» (AGT-07). */
  requestDeleteLimit: oc
    .route({ method: "POST", path: "/budgets/limit/delete" })
    .input(IdOf(LimitId))
    .output(z.strictObject({ decisionId: DecisionId }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
  /** Новая цель (BUD-04) с «Отменить»; по счёту — только накопительный счёт или вклад. */
  createGoal: oc
    .route({ method: "POST", path: "/budgets/goal" })
    .input(CreateGoalInput)
    .output(GoalChange)
    .errors(WriteErrors),
  /** Правка цели с «Отменить»: название, сумма, срок. */
  updateGoal: oc
    .route({ method: "POST", path: "/budgets/goal/update" })
    .input(UpdateGoalInput)
    .output(GoalChange)
    .errors(WriteErrors),
  /** Взнос в копилку (BUD-04) с «Отменить»; цель по счёту — `VALIDATION { reason: "linked-goal" }`. */
  contribute: oc
    .route({ method: "POST", path: "/budgets/goal/contribute" })
    .input(ContributeInput)
    .output(GoalChange)
    .errors(WriteErrors),
  /** Удаление цели — только решением «Да/Нет» (AGT-07). */
  requestDeleteGoal: oc
    .route({ method: "POST", path: "/budgets/goal/delete" })
    .input(IdOf(GoalId))
    .output(z.strictObject({ decisionId: DecisionId }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
  /** Рекомендуемый взнос до создания цели (BUD-05). */
  previewGoal: oc
    .route({ method: "GET", path: "/budgets/goal/preview" })
    .input(PreviewGoalInput)
    .output(GoalPreview)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
};
