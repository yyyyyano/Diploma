// Операции (TXN-01…05, FIN-01, STMT-02, STMT-09): таблица со страницами и фильтрами, карточка с историей, ручной ввод и
// правка с «Отменить», удаление через подтверждение. Суммы — Money (копейки + валюта операции) и эквивалент в BYN по
// курсу НБРБ на день операции; курса нет — `amountInByn: null` («курс не получен»), а не 0. Числа считает сервер
// (@kosht/calc), «Откуда курс?» — transactions.explainRate. Фильтры списка — плоские поля строки запроса (GET): числа
// приходят строкой, поэтому coerce.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { TraceId } from "@kosht/kernel";
import { AccountId, FxRateInfo } from "../accounts/accounts.contract.ts";
import { DecisionId, UndoToken } from "../actions/actions.contract.ts";
import {
  CategoryId,
  CategoryRef,
  CategorySource,
  SystemCategoryCode,
} from "../categories/categories.contract.ts";
import { LocalDate, Money, PageNumber, RowCount } from "../common.ts";
import { pickErrors } from "../errors.ts";

export const TransactionId = z.uuid().brand<"TransactionId">();
export type TransactionId = z.infer<typeof TransactionId>;

/** TXN-01: доход, расход, перевод между своими счетами, возврат. */
export const TransactionType = z.enum(["expense", "income", "transfer", "refund"]);
export type TransactionType = z.infer<typeof TransactionType>;

/** Куда двинулись деньги по счёту: у расхода — со счёта, у дохода и возврата — на счёт, у перевода — как выбрали. */
export const Direction = z.enum(["in", "out"]);
export type Direction = z.infer<typeof Direction>;

/** Откуда операция: вы, ассистент по сообщению, выписка, чек. */
export const TransactionSource = z.enum(["manual", "assistant", "statement", "receipt"]);
export type TransactionSource = z.infer<typeof TransactionSource>;

export const Visibility = z.enum(["personal", "shared"]);

/** Время суток «08:47» (минуты; секунд в данных нет). */
export const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Строка таблицы и карточка: то, что видно в списке, плюс поля карточки. */
export const Transaction = z.strictObject({
  id: TransactionId,
  accountId: AccountId,
  type: TransactionType,
  direction: Direction,
  occurredOn: LocalDate.schema,
  occurredTime: TimeOfDay.nullable(),
  /** Сумма в валюте операции (= валюта счёта), всегда положительная: знак — по направлению. */
  amount: Money.schema,
  /** Эквивалент в BYN по курсу НБРБ на день операции; BYN-операция — та же сумма; курса нет — null. */
  amountInByn: Money.schema.nullable(),
  /** Исходное описание — как пришло (выписка, чат) или как ввели; не меняется (STMT-06). */
  description: z.string(),
  /** Контрагент для человека: из справочника или как ввели; null — не указан. */
  merchantName: z.string().nullable(),
  note: z.string().nullable(),
  /** У перевода категории нет. */
  category: CategoryRef.nullable(),
  categorySource: CategorySource.nullable(),
  source: TransactionSource,
  visibility: Visibility,
  transferPairId: TransactionId.nullable(),
  refundOfId: TransactionId.nullable(),
  /** Импорт выписки, из которого пришла операция (STMT-10: из карточки открывают импорт и файл); иначе null. */
  importId: z.uuid().nullable(),
  /** Чек операции (RCPT-11: из карточки открывают чек и фото); у остальных null. */
  receiptId: z.uuid().nullable(),
  /** «Ожидает выписки» (RCPT-10): предварительная операция от чека по карте — в тратах есть, остаток не меняет. */
  pending: z.boolean(),
  /** Чек операции «требует проверки» (TXN-01). */
  needsReview: z.boolean(),
  version: z.int().min(1),
});
export type Transaction = z.infer<typeof Transaction>;

/** Поля истории изменений (TXN-05) — порядок как в карточке. */
export const TransactionField = z.enum([
  "account",
  "type",
  "date",
  "time",
  "amount",
  "amountInByn",
  "merchant",
  "note",
  "category",
]);
export type TransactionField = z.infer<typeof TransactionField>;

/** Запись истории: что сделано, кем (канал) и что изменилось. Текст пишет сайт из словаря. */
export const TransactionRevision = z.strictObject({
  at: z.iso.datetime(),
  action: z.enum(["created", "updated", "deleted", "restored"]),
  channel: z.enum(["web", "telegram", "system"]),
  fields: z.array(TransactionField),
});
export type TransactionRevision = z.infer<typeof TransactionRevision>;

export const TransactionCard = z.strictObject({
  transaction: Transaction,
  /** Курс НБРБ, по которому посчитан эквивалент в BYN; BYN-операция и «курс не получен» — null. */
  rate: FxRateInfo.nullable(),
  history: z.array(TransactionRevision),
});
export type TransactionCard = z.infer<typeof TransactionCard>;

/** Число из строки запроса GET («2») или готовое целое. */
const Numeric = z.union([
  z.int(),
  z
    .string()
    .regex(/^\d{1,12}$/)
    .transform(Number),
]);

/** Параметры списка (TXN-02): страница, размер ≤ 100, поиск по тексту и фильтры; в адресе страницы. */
export const TransactionListInput = z
  .strictObject({
    page: Numeric.pipe(PageNumber).default(1),
    pageSize: Numeric.pipe(z.int().min(1).max(100)).default(50),
    query: z.string().trim().max(100).optional(),
    from: LocalDate.schema.optional(),
    to: LocalDate.schema.optional(),
    accountId: AccountId.optional(),
    /** Встроенная категория по коду или своя по id — не обе сразу. */
    categoryCode: SystemCategoryCode.optional(),
    categoryId: CategoryId.optional(),
    type: TransactionType.optional(),
    /** Границы суммы в BYN по эквиваленту, в копейках (без эквивалента операция не проходит фильтр). */
    amountFrom: Numeric.optional(),
    amountTo: Numeric.optional(),
    source: TransactionSource.optional(),
    /** Только операции с чеком (true) или без него (false). */
    hasReceipt: z
      .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
      .optional(),
    /** Только операции с чеком, который требует проверки (TXN-01). */
    needsReview: z
      .union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])
      .optional(),
  })
  .refine((input) => input.categoryCode === undefined || input.categoryId === undefined, {
    message: "categoryCode и categoryId — не вместе",
  });
export type TransactionListInput = z.input<typeof TransactionListInput>;

export const TransactionList = z.strictObject({
  items: z.array(Transaction),
  page: PageNumber,
  pageSize: z.int().min(1).max(100),
  total: RowCount,
});
export type TransactionList = z.infer<typeof TransactionList>;

const Merchant = z.string().trim().min(1).max(120);
const Note = z.string().trim().min(1).max(500);

/**
 * Новая операция (TXN-03): счёт не указан — «Наличные»; валюта суммы — валюта счёта (иначе VALIDATION). Категория не
 * указана — подбирают правила, непокрытое доберёт модель в фоне. `direction` — только у перевода.
 */
export const CreateTransactionInput = z.strictObject({
  accountId: AccountId.optional(),
  type: TransactionType,
  direction: Direction.optional(),
  occurredOn: LocalDate.schema,
  occurredTime: TimeOfDay.nullable().default(null),
  amount: Money.schema,
  merchant: Merchant.nullable().default(null),
  note: Note.nullable().default(null),
  category: CategoryRef.nullable().default(null),
});
export type CreateTransactionInput = z.input<typeof CreateTransactionInput>;

/** Правка (TXN-03): только указанные поля; `expectedVersion` — версия, которую человек видел (иначе CONFLICT). */
export const UpdateTransactionPatch = z.strictObject({
  accountId: AccountId.optional(),
  type: TransactionType.optional(),
  direction: Direction.optional(),
  occurredOn: LocalDate.schema.optional(),
  occurredTime: TimeOfDay.nullable().optional(),
  amount: Money.schema.optional(),
  merchant: Merchant.nullable().optional(),
  note: Note.nullable().optional(),
  category: CategoryRef.nullable().optional(),
});
export type UpdateTransactionPatch = z.infer<typeof UpdateTransactionPatch>;

export const UpdateTransactionInput = z.strictObject({
  id: TransactionId,
  expectedVersion: z.int().min(1).optional(),
  patch: UpdateTransactionPatch,
});
export type UpdateTransactionInput = z.input<typeof UpdateTransactionInput>;

const Change = z.strictObject({ transaction: Transaction, undoToken: UndoToken });

/**
 * «Применить к N прошлым операциям?» (CAT-05): ручная смена категории создала правило для контрагента; прошлых
 * операций с ним, которые правило изменит, — `count`; ответ «Да» — `actions.answer` по `decisionId`.
 */
export const ApplyToPast = z.strictObject({ decisionId: DecisionId, count: z.int().min(1) });
export type ApplyToPast = z.infer<typeof ApplyToPast>;

/** Результат правки: изменённая операция, «Отменить» и, если исправление создало правило, вопрос про прошлые. */
export const UpdateResult = Change.extend({ applyToPast: ApplyToPast.nullable() });
export type UpdateResult = z.infer<typeof UpdateResult>;

/** Сколько операций за один раз можно выбрать для удаления и массовых действий (T-022). */
export const MAX_BULK = 500;

export const transactionsContract = {
  /** TXN-02: страница операций с фильтрами; последний ключ сортировки — id. */
  list: oc
    .route({ method: "GET", path: "/transactions" })
    .input(TransactionListInput)
    .output(TransactionList)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
  /** Карточка операции с историей изменений (TXN-05). */
  get: oc
    .route({ method: "GET", path: "/transactions/item" })
    .input(z.strictObject({ id: TransactionId }))
    .output(TransactionCard)
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
  /** Новая операция сразу, с «Отменить» (TXN-03). */
  create: oc
    .route({ method: "POST", path: "/transactions" })
    .input(CreateTransactionInput)
    .output(Change)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION", "NOT_FOUND")),
  /** Правка сразу, с «Отменить»; операцию правили после того, как её открыли, — CONFLICT. */
  update: oc
    .route({ method: "POST", path: "/transactions/update" })
    .input(UpdateTransactionInput)
    .output(UpdateResult)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION", "NOT_FOUND", "CONFLICT")),
  /** Удаление — только после «Да» (AGT-07): ожидающее решение; «Отменить» отдаёт actions.answer. */
  requestDelete: oc
    .route({ method: "POST", path: "/transactions/delete" })
    .input(z.strictObject({ ids: z.array(TransactionId).min(1).max(MAX_BULK) }))
    .output(z.strictObject({ decisionId: DecisionId }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
  /** Массовая смена категории (TXN-04, AGT-07): ожидающее решение с числом и примерами; «Да» исполняет код. */
  requestChangeCategory: oc
    .route({ method: "POST", path: "/transactions/change-category" })
    .input(
      z.strictObject({ ids: z.array(TransactionId).min(1).max(MAX_BULK), category: CategoryRef }),
    )
    .output(z.strictObject({ decisionId: DecisionId }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND", "VALIDATION")),
  /** Пометить выбранные переводом (TXN-04, AGT-07): ожидающее решение; у перевода нет категории. */
  requestMarkTransfer: oc
    .route({ method: "POST", path: "/transactions/mark-transfer" })
    .input(z.strictObject({ ids: z.array(TransactionId).min(1).max(MAX_BULK) }))
    .output(z.strictObject({ decisionId: DecisionId }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
  /** «Откуда курс?» (EXPL-01): расчёт эквивалента в BYN с курсом НБРБ; курса нет — UNAVAILABLE. */
  explainRate: oc
    .route({ method: "POST", path: "/transactions/explain-rate" })
    .input(z.strictObject({ id: TransactionId }))
    .output(z.strictObject({ traceId: TraceId }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND", "UNAVAILABLE")),
};
