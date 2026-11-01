// Налоговые вычеты (TAX-01…07, PROF-06): калькулятор «Обучение / Жильё / Дети» по ст. 209–211 НК. Деньги — Money в BYN, ставка
// и суммы вычетов — из таблицы ставок (только подтверждённые), считает сервер (@kosht/calc); у каждого показанного числа —
// traceId («Откуда эта цифра?», EXPL-02). Нет подтверждённого значения — честный `no-data`, а не ноль (P1). Тот же результат
// отдаёт инструмент агента `calculate_deduction` и сайт: карточка в чате и экран «Налоговые вычеты».
import { TraceId } from "@kosht/kernel";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { LawCitationData } from "../chat/agent-parts.ts";
import { UndoToken } from "../actions/actions.contract.ts";
import { LocalDate, Money } from "../common.ts";
import { pickErrors } from "../errors.ts";
import { CHECKLIST_IDS } from "../legal-consult/legal-consult.contract.ts";
import { EmploymentType } from "../profile/profile.contract.ts";

export const DEDUCTION_KINDS = ["education", "housing", "children"] as const;
export const DeductionKind = z.enum(DEDUCTION_KINDS);
export type DeductionKind = z.infer<typeof DeductionKind>;

/** Зарплата в месяц, названная человеком: начисленная (в расчётном листке) или «на руки» (TAX-04: тогда это оценка). */
export const DeductionIncome = z.strictObject({
  amount: Money.schema,
  basis: z.enum(["gross", "net"]),
});
export type DeductionIncome = z.infer<typeof DeductionIncome>;

export const CalculateDeductionInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("education"),
    /** Сколько заплатили за обучение (за себя или близкого родственника) в году. */
    paid: Money.schema,
    /** Облагаемый доход за год, если известен: меньше оплаты — остаток вычета переносится (TAX-05). */
    annualTaxable: Money.schema.optional(),
  }),
  z.strictObject({
    kind: z.literal("housing"),
    /** Расходы на строительство или покупку жилья, включая проценты по кредиту. */
    expenses: Money.schema,
    income: DeductionIncome.optional(),
  }),
  z.strictObject({
    kind: z.literal("children"),
    income: DeductionIncome.optional(),
  }),
]);
export type CalculateDeductionInput = z.input<typeof CalculateDeductionInput>;

/**
 * Вход инструмента агента `calculate_deduction`: плоский объект (схема инструмента — объект), поля по виду вычета —
 * обучение: `paid` (и `annualTaxable`), жильё: `expenses` (и `income`), дети: только `income`. Сервер собирает из него
 * `CalculateDeductionInput`; чего не хватает для вида — `VALIDATION` с названием поля, модель поправит вызов.
 */
export const CalculateDeductionToolInput = z.strictObject({
  kind: DeductionKind,
  paid: Money.schema.optional(),
  annualTaxable: Money.schema.optional(),
  expenses: Money.schema.optional(),
  income: DeductionIncome.optional(),
});
export type CalculateDeductionToolInput = z.input<typeof CalculateDeductionToolInput>;

/** Число расчёта с трассой «Откуда эта цифра?». */
export const DeductionAmount = z.strictObject({ amount: Money.schema, traceId: TraceId });
export type DeductionAmount = z.infer<typeof DeductionAmount>;

/** Способ получения (TAX-06): наниматель в течение года или ИМНС по декларации. */
export const DEDUCTION_WAYS = ["employer", "tax-office"] as const;

/**
 * Пометки результата — сайт и модель говорят о них своими словами:
 * `income-estimated` — начисленное оценено из «на руки» (TAX-04);
 * `ask-gross` — спросить зарплату до вычета налогов (TAX-04), ответ сохраняется фактом `income.gross`;
 * `upper-bound` — сумма «до»: доход не известен, вернуть можно не больше налога с дохода (TAX-05);
 * `high-income` — годовой доход выше порога повышенной ставки, ИМНС досчитает налог по итогам года (TAX-05);
 * `ip-declaration` — ИП: вычет только через годовую декларацию (TAX-02);
 * `npd-with-salary` — есть НПД и зарплата: вычеты считаются по зарплате (TAX-02).
 */
export const DEDUCTION_FLAGS = [
  "income-estimated",
  "ask-gross",
  "upper-bound",
  "high-income",
  "ip-declaration",
  "npd-with-salary",
] as const;
export const DeductionFlag = z.enum(DEDUCTION_FLAGS);
export type DeductionFlag = z.infer<typeof DeductionFlag>;

/** Почему вычет не посчитан: `npd-only` — вычетов к доходу НПД нет; `rate-unconfirmed` — значение таблицы ждёт подтверждения; `no-children`. */
export const DeductionReason = z.enum(["npd-only", "rate-unconfirmed", "no-children"]);
export type DeductionReason = z.infer<typeof DeductionReason>;

/** Срок использования вычета на жильё: целое число месяцев, `approx` — округлено («≈ 41 мес.»). */
export const DeductionTerm = z.strictObject({
  months: z.int().min(1),
  approx: z.boolean(),
  traceId: TraceId,
});

export const DeductionResult = z.strictObject({
  kind: DeductionKind,
  status: z.enum(["ok", "not-applicable", "no-data"]),
  reason: DeductionReason.nullable(),
  /** Параметры таблицы, чьё подтверждённое значение не нашлось (для `rate-unconfirmed`). */
  missing: z.array(z.string().max(64)).max(10),
  /** Год, к которому относятся суммы вычетов и ставка. */
  year: z.int().min(2000).max(2100),
  /** Тип занятости из профиля; `null` — не известен (считаем как наёмного работника). */
  employment: z.array(EmploymentType).nullable(),
  /** Ставка подоходного налога в процентах (13). */
  ratePercent: z.int().min(0).max(100).nullable(),
  /** Вычет: оплата обучения / расходы на жильё (за всё время) / вычет на детей в месяц. */
  deduction: DeductionAmount.nullable(),
  savingMonthly: DeductionAmount.nullable(),
  /** Экономия за год. */
  savingYear: DeductionAmount.nullable(),
  /** Экономия за весь вычет — «до», пока вычет использован не целиком. */
  savingTotal: DeductionAmount.nullable(),
  /** Остаток вычета, переносимый на следующие годы; `null` — не известен или переносить нечего. */
  carryOver: DeductionAmount.nullable(),
  term: DeductionTerm.nullable(),
  /** Почему срока нет: зарплата не известна или вся уходит на стандартные вычеты. */
  termReason: z.enum(["no-income", "no-taxable"]).nullable(),
  /** Доход в месяц, по которому считали (начисленный; оценка — с пометкой `income-estimated`). */
  income: DeductionAmount.nullable(),
  /** Стандартные вычеты в месяц, применённые раньше имущественного. */
  standard: DeductionAmount.nullable(),
  /** Дети до 18 лет на сегодня (PROF-06) и применён ли повышенный вычет. */
  children: z.strictObject({ count: z.int().min(0), increased: z.boolean() }).nullable(),
  ways: z.array(z.enum(DEDUCTION_WAYS)).max(2),
  flags: z.array(DeductionFlag).max(6),
  checklistId: z.enum(CHECKLIST_IDS),
  /** Дословные цитаты норм, на которых держится расчёт (P3). */
  citations: z.array(LawCitationData).max(10),
});
export type DeductionResult = z.infer<typeof DeductionResult>;

export const FoundDeductionId = z.uuid().brand<"FoundDeductionId">();
export type FoundDeductionId = z.infer<typeof FoundDeductionId>;

/** Состояния найденного вычета (TAX-20): новый → показан → «Не моё» (отклонён, больше не предлагается) | оформлен. */
export const FOUND_STATUSES = ["new", "shown", "dismissed", "filed"] as const;
export const FoundStatus = z.enum(FOUND_STATUSES);
export type FoundStatus = z.infer<typeof FoundStatus>;

/**
 * Найденный по операциям вычет (TAX-20): одна запись на основание — оплату обучения (операция), детей в профиле, платежи по кредиту
 * при учёте нуждающихся. `reason` у жилья: `ask-queue` — один вопрос об учёте нуждающихся (ответ — факт `housingQueue`), `check` —
 * учёт есть, проверьте условия. Сумма «до» — результат калькулятора (T-045) с `traceId`; у жилья без расчёта — `null`.
 */
export const FoundDeduction = z.strictObject({
  id: FoundDeductionId,
  kind: DeductionKind,
  status: FoundStatus,
  reason: z.enum(["ask-queue", "check"]).nullable(),
  year: z.int().min(2000).max(2100),
  amount: DeductionAmount.nullable(),
  /** Получатель платежа («БГУ»); у основания-факта — null. */
  payee: z.string().max(120).nullable(),
  /** Операция-основание: открывается в «Операциях»; день и сумма — снимок на момент находки. */
  operation: z
    .strictObject({ id: z.uuid(), on: LocalDate.schema, amount: Money.schema })
    .nullable(),
  foundOn: LocalDate.schema,
});
export type FoundDeduction = z.infer<typeof FoundDeduction>;

export const FoundList = z.strictObject({ items: z.array(FoundDeduction) });
export type FoundList = z.infer<typeof FoundList>;

/** Куда можно перевести найденный вычет вручную: «Не моё», «Оформлено», «Вернуть» (снова показан). */
export const SettableFoundStatus = z.enum(["dismissed", "filed", "shown"]);

export const taxContract = {
  /** Найденные вычеты пользователя: активные, оформленные и отклонённые (их можно вернуть) — свежие первыми. */
  found: oc
    .route({ method: "GET", path: "/tax/found" })
    .output(FoundList)
    .errors(pickErrors("UNAUTHORIZED")),
  /** Человек увидел новые находки: «новый» → «показан». Остальные состояния не меняются. */
  markFoundShown: oc
    .route({ method: "POST", path: "/tax/found/shown" })
    .input(z.strictObject({ ids: z.array(FoundDeductionId).min(1).max(50) }))
    .output(z.strictObject({ ok: z.literal(true) }))
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
  /** «Это не моё», «Оформлено», «Вернуть» — сразу, с «Отменить» (P5). */
  setFoundStatus: oc
    .route({ method: "POST", path: "/tax/found/status" })
    .input(z.strictObject({ id: FoundDeductionId, status: SettableFoundStatus }))
    .output(z.strictObject({ found: FoundDeduction, undoToken: UndoToken }))
    .errors(pickErrors("UNAUTHORIZED", "NOT_FOUND", "VALIDATION")),
  /** Расчёт вычета «Обучение / Жильё / Дети» на сегодня; значения — только подтверждённые из таблицы ставок. */
  calculate: oc
    .route({ method: "POST", path: "/tax/calculate" })
    .input(CalculateDeductionInput)
    .output(DeductionResult)
    .errors(pickErrors("UNAUTHORIZED", "VALIDATION")),
};
