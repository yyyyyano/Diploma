// Счета (STMT-01, STMT-02, STMT-09): счета домохозяйства сессии с остатком и датой, на которую он известен, итоги в
// BYN по курсу НБРБ. «Наличные» есть у каждого с самого начала, «Карта, не указана» — служебный счёт для чеков,
// оплаченных неизвестной картой (появляется, когда понадобится). Название null — подпись по виду даёт сайт из словаря.
// Суммы — Money (копейки + валюта); числа считает сервер (@kosht/calc), «Откуда эта цифра?» — accounts.explain.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { DecisionId, UndoToken } from "../actions/actions.contract.ts";
import { LocalDate, Money } from "../common.ts";
import { pickErrors } from "../errors.ts";
import { TraceId } from "@kosht/kernel";

export const AccountId = z.uuid().brand<"AccountId">();
export type AccountId = z.infer<typeof AccountId>;

/**
 * Вид счёта (SPEC §5): карта, текущий, накопительный, вклад, наличные; `unknown-card` — служебный «Карта, не указана»
 * (RCPT-10).
 */
export const AccountKind = z.enum([
  "cash",
  "card",
  "current",
  "savings",
  "deposit",
  "unknown-card",
]);
export type AccountKind = z.infer<typeof AccountKind>;

/** Виды, которые человек заводит сам (служебные создаёт система). */
export const NewAccountKind = z.enum(["card", "current", "savings", "deposit", "cash"]);

/** Откуда известен остаток (STMT-02): указан вами, из выписки, по операциям. */
export const BalanceSource = z.enum(["manual", "statement", "operations"]);
export type BalanceSource = z.infer<typeof BalanceSource>;

/** Код валюты ISO 4217. */
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);

/** Курс НБРБ, по которому посчитан эквивалент в BYN: BYN за `scale` единиц в десятитысячных, на день `date`. */
export const FxRateInfo = z.strictObject({
  rateE4: z.int().positive(),
  scale: z.int().positive(),
  date: LocalDate.schema,
});

export const AccountListItem = z.strictObject({
  id: AccountId,
  kind: AccountKind,
  /** Своё название; null — подпись по виду. */
  name: z.string().nullable(),
  bank: z.string().nullable(),
  /** Последние 4 цифры номера. */
  mask: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  /** Остаток в валюте счёта (STMT-02). */
  balance: Money.schema,
  /** День, на который остаток известен — показывается всегда (STMT-02). */
  balanceOn: LocalDate.schema,
  balanceSource: BalanceSource,
  initialBalance: Money.schema,
  /** Эквивалент в BYN по курсу НБРБ на сегодня (не BYN); курса нет — null. */
  balanceInByn: Money.schema.nullable(),
  rate: FxRateInfo.nullable(),
});
export type AccountListItem = z.infer<typeof AccountListItem>;

export const AccountTotals = z.strictObject({
  /** Всего на счетах в BYN; курса хотя бы одной валюты нет — null (не 0). */
  total: Money.schema.nullable(),
  /** Без накопительных счетов и вкладов (денег, отложенных под цели). */
  available: Money.schema.nullable(),
  /** Валюты без курса НБРБ на сегодня — итог в BYN по ним не показан. */
  missingRates: z.array(CurrencyCode),
});

export const AccountList = z.strictObject({
  onDate: LocalDate.schema,
  items: z.array(AccountListItem),
  totals: AccountTotals,
});
export type AccountList = z.infer<typeof AccountList>;

const Name = z.string().trim().min(1).max(60);

export const CreateAccountInput = z.strictObject({
  kind: NewAccountKind,
  name: Name.nullable().default(null),
  bank: z.string().trim().min(1).max(60).nullable().default(null),
  mask: z
    .string()
    .regex(/^\d{4}$/)
    .nullable()
    .default(null),
  currency: CurrencyCode.default("BYN"),
  /** Начальный остаток (STMT-01): можно не указывать — возьмётся из первой выписки. */
  initialBalance: Money.schema.nullable().default(null),
});
export type CreateAccountInput = z.input<typeof CreateAccountInput>;

/** Что объяснить: итог, «без накопительного» или эквивалент счёта в BYN / его остаток. */
export const ExplainSubject = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("total") }),
  z.strictObject({ kind: z.literal("available") }),
  z.strictObject({ kind: z.literal("account"), id: AccountId }),
]);

const AccountChange = z.strictObject({ account: AccountListItem, undoToken: UndoToken });

export const accountsContract = {
  /** Счета своего домохозяйства с итогами: «Наличные» первыми. */
  list: oc
    .route({ method: "GET", path: "/accounts" })
    .output(AccountList)
    .errors(pickErrors("UNAUTHORIZED")),
  /** Новый счёт вручную (STMT-01) с «Отменить». */
  create: oc
    .route({ method: "POST", path: "/accounts" })
    .input(CreateAccountInput)
    .output(AccountChange)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION", "CONFLICT")),
  /** Переименовать с «Отменить». */
  rename: oc
    .route({ method: "POST", path: "/accounts/rename" })
    .input(z.strictObject({ id: AccountId, name: Name }))
    .output(AccountChange)
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND")),
  /** Начальный остаток (STMT-01) с «Отменить»: остаток сдвигается на ту же разницу. */
  setInitialBalance: oc
    .route({ method: "POST", path: "/accounts/initial-balance" })
    .input(z.strictObject({ id: AccountId, initialBalance: Money.schema }))
    .output(AccountChange)
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND", "VALIDATION")),
  /** Удалить — только через подтверждение (AGT-07): ожидающее решение, «Да» удаляет. */
  requestDelete: oc
    .route({ method: "POST", path: "/accounts/delete" })
    .input(z.strictObject({ id: AccountId }))
    .output(z.strictObject({ decisionId: DecisionId }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND", "ACCOUNT_PROTECTED")),
  /** «Откуда эта цифра?» (EXPL-01): сохранить расчёт числа экрана и вернуть его traceId. */
  explain: oc
    .route({ method: "POST", path: "/accounts/explain" })
    .input(z.strictObject({ subject: ExplainSubject }))
    .output(z.strictObject({ traceId: TraceId }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND", "UNAVAILABLE")),
};
