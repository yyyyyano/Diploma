// Регулярные платежи и подписки (REC-01…05): список по разделам с периодом, средней суммой, следующей датой и состоянием;
// решения по предположениям («Да, регулярный», «Это не регулярный», «Да, прекращён», «Ещё придёт»), правка и добавление
// вручную — каждое с «Отменить» (P5). Суммы — Money в BYN, числа считает сервер (@kosht/calc), «Откуда эта цифра?» —
// recurring.explain; «регулярный» в «Операциях» — recurring.markers (строки страницы пачкой).
import { oc } from "@orpc/contract";
import { TraceId } from "@kosht/kernel";
import { z } from "zod";
import { UndoToken } from "../actions/actions.contract.ts";
import { LocalDate, Money } from "../common.ts";
import { pickErrors } from "../errors.ts";

export const RecurringId = z.uuid().brand<"RecurringId">();
export type RecurringId = z.infer<typeof RecurringId>;

/** REC-01: период — неделя, месяц, квартал, год. */
export const RECURRING_PERIODS = ["week", "month", "quarter", "year"] as const;
export const RecurringPeriod = z.enum(RECURRING_PERIODS);
export type RecurringPeriod = z.infer<typeof RecurringPeriod>;

/** REC-02: разделы экрана — Доходы, Обязательные, Подписки, Другие регулярные (в свободный остаток не входят). */
export const RECURRING_SECTIONS = ["income", "mandatory", "subscriptions", "other"] as const;
export const RecurringSection = z.enum(RECURRING_SECTIONS);
export type RecurringSection = z.infer<typeof RecurringSection>;

/** REC-02, REC-05: предположение, действует, возможно прекращён, прекращён (человек подтвердил), исключён. */
export const RecurringState = z.enum(["active", "suggested", "maybe-ended", "ended", "excluded"]);
export type RecurringState = z.infer<typeof RecurringState>;

/** Доход или расход (REC-01: касается и зарплаты, и ЖКХ). */
export const RecurringFlow = z.enum(["income", "expense"]);
export type RecurringFlow = z.infer<typeof RecurringFlow>;

export const RecurringItem = z.strictObject({
  id: RecurringId,
  name: z.string(),
  flow: RecurringFlow,
  section: RecurringSection,
  period: RecurringPeriod,
  state: RecurringState,
  source: z.enum(["detected", "manual"]),
  /** День месяца (у еженедельных — null). */
  anchorDay: z.int().min(1).max(31).nullable(),
  /** Средняя сумма платежа в BYN (или названная человеком). */
  amount: Money.schema,
  amountIsManual: z.boolean(),
  /** Наименьшая и наибольшая сумма повторов, если они различаются (ЖКХ: «от 172,10 до 201,40»); иначе null. */
  amountRange: z.strictObject({ min: Money.schema, max: Money.schema }).nullable(),
  /** Сумма в пересчёте на месяц (REC-04). */
  monthly: Money.schema,
  nextExpectedOn: LocalDate.schema,
  lastOccurredOn: LocalDate.schema.nullable(),
  /** Сколько дней прошло после ожидаемой даты на день списка; null — ещё не наступила. */
  overdueDays: z.int().min(1).nullable(),
  /** Повторы, по которым найден платёж, — основание средней (для «Показать операции»). */
  repeats: z.int().min(0),
  /** Категория последней операции: встроенный код или id своей. */
  categoryCode: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  /** Входит ли в свободный остаток (REC-04). */
  counted: z.boolean(),
});
export type RecurringItem = z.infer<typeof RecurringItem>;

export const RecurringListInput = z.strictObject({ section: RecurringSection.optional() });

export const RecurringSectionTotal = z.strictObject({
  section: RecurringSection,
  /** Итог раздела в месяц по учитываемым платежам; «Другие» не входят в остаток — итога нет. */
  monthly: Money.schema.nullable(),
  yearly: Money.schema.nullable(),
});

export const RecurringList = z.strictObject({
  onDate: LocalDate.schema,
  items: z.array(RecurringItem),
  totals: z.array(RecurringSectionTotal),
});
export type RecurringList = z.infer<typeof RecurringList>;

/** Вход «Исправить сумму и дату»: меняется только присланное. */
export const RecurringEditInput = z.strictObject({
  id: RecurringId,
  amount: Money.schema.optional(),
  period: RecurringPeriod.optional(),
  anchorDay: z.int().min(1).max(31).optional(),
  section: RecurringSection.optional(),
});

/** Вход «Добавить вручную»: что это, название, сумма, период, день. */
export const RecurringCreateInput = z.strictObject({
  name: z.string().trim().min(1).max(80),
  section: RecurringSection,
  amount: Money.schema,
  period: RecurringPeriod,
  anchorDay: z.int().min(1).max(31).optional(),
});

const IdInput = z.strictObject({ id: RecurringId });
const Changed = z.strictObject({ item: RecurringItem, undoToken: UndoToken });
const ChangeErrors = pickErrors("UNAUTHORIZED", "VALIDATION", "NOT_FOUND", "CONFLICT");

/** Не больше стольких операций страницы «Операций» за раз. */
export const MARKERS_MAX = 100;

export const recurringContract = {
  list: oc
    .route({ method: "GET", path: "/recurring" })
    .input(RecurringListInput)
    .output(RecurringList)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
  /** «Да, регулярный» (предположение → действует). */
  confirm: oc
    .route({ method: "POST", path: "/recurring/confirm" })
    .input(IdInput)
    .output(Changed)
    .errors(ChangeErrors),
  /** «Это не регулярный»: платёж исключён и больше не находится поиском. */
  exclude: oc
    .route({ method: "POST", path: "/recurring/exclude" })
    .input(IdInput)
    .output(Changed)
    .errors(ChangeErrors),
  /** «Да, прекращён». */
  end: oc
    .route({ method: "POST", path: "/recurring/end" })
    .input(IdInput)
    .output(Changed)
    .errors(ChangeErrors),
  /** «Вернуть в регулярные» (из прекращённых и исключённых). */
  resume: oc
    .route({ method: "POST", path: "/recurring/resume" })
    .input(IdInput)
    .output(Changed)
    .errors(ChangeErrors),
  /** «Ещё придёт»: «возможно прекращён» на эту ожидаемую дату больше не ставится. */
  stillComing: oc
    .route({ method: "POST", path: "/recurring/still-coming" })
    .input(IdInput)
    .output(Changed)
    .errors(ChangeErrors),
  edit: oc
    .route({ method: "POST", path: "/recurring/edit" })
    .input(RecurringEditInput)
    .output(Changed)
    .errors(ChangeErrors),
  create: oc
    .route({ method: "POST", path: "/recurring/create" })
    .input(RecurringCreateInput)
    .output(Changed)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
  /** «Откуда эта цифра?» (EXPL-01): расчёт средней суммы платежа с операциями-основаниями. */
  explain: oc
    .route({ method: "POST", path: "/recurring/explain" })
    .input(IdInput)
    .output(z.strictObject({ traceId: TraceId }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND", "UNAVAILABLE")),
  /** Какие из операций страницы входят в регулярный платёж (признак «регулярный» в «Операциях»). */
  markers: oc
    .route({ method: "POST", path: "/recurring/markers" })
    .input(z.strictObject({ ids: z.array(z.uuid()).max(MARKERS_MAX) }))
    .output(z.strictObject({ ids: z.array(z.uuid()) }))
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
};
