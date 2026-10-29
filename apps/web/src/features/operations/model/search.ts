// Адрес экрана «Операции» (TXN-02): страница, поиск и фильтры живут в адресе — ссылку можно сохранить и отправить, «назад»
// возвращает прежний вид; открытая карточка — `op`. Неверное значение отбрасывается (`catch`): адрес, набранный руками,
// не ломает экран. Категория — строкой «system:taxi» / «custom:<id>» (как `refKey`), сумма — текстом, как её вводят.
import {
  AccountId,
  CategoryId,
  LocalDate,
  SystemCategoryCode,
  TransactionId,
  TransactionSource,
  TransactionType,
  type CategoryRef,
  type TransactionListInput,
} from "@kosht/contract";
import { parseMoney } from "@kosht/i18n";
import { z } from "zod";

export const PAGE_SIZE = 50;

const CATEGORY = /^(system|custom):(.+)$/;

/** «system:taxi» → ссылка на категорию; не по схеме — `undefined`. */
export function parseCategoryKey(key: string | undefined): CategoryRef | undefined {
  const match = key === undefined ? null : CATEGORY.exec(key);
  if (match === null) return undefined;
  if (match[1] === "system") {
    const code = SystemCategoryCode.safeParse(match[2]);
    return code.success ? { type: "system", code: code.data } : undefined;
  }
  const id = CategoryId.safeParse(match[2]);
  return id.success ? { type: "custom", id: id.data } : undefined;
}

export const OperationsSearch = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  type: TransactionType.optional().catch(undefined),
  from: LocalDate.schema.optional().catch(undefined),
  to: LocalDate.schema.optional().catch(undefined),
  account: AccountId.optional().catch(undefined),
  category: z.string().regex(CATEGORY).optional().catch(undefined),
  min: z.string().max(20).optional().catch(undefined),
  max: z.string().max(20).optional().catch(undefined),
  source: TransactionSource.optional().catch(undefined),
  /** Открытая карточка операции. */
  op: TransactionId.optional().catch(undefined),
});
export type OperationsSearch = z.infer<typeof OperationsSearch>;

/** Сумма из адреса в копейках BYN; пусто или не сумма — `undefined` (фильтр не применяется). */
export function amountMinor(text: string | undefined): number | undefined {
  if (text === undefined || text.trim() === "") return undefined;
  return parseMoney(text, "BYN")?.minor;
}

/** Вход `transactions.list` по адресу: только заданные поля, страница — своя или первая. */
export function toListInput(search: OperationsSearch, page?: number): TransactionListInput {
  const category = parseCategoryKey(search.category);
  const min = amountMinor(search.min);
  const max = amountMinor(search.max);
  return {
    page: page ?? search.page ?? 1,
    pageSize: PAGE_SIZE,
    ...(search.q === undefined || search.q === "" ? {} : { query: search.q }),
    ...(search.from === undefined ? {} : { from: search.from }),
    ...(search.to === undefined ? {} : { to: search.to }),
    ...(search.account === undefined ? {} : { accountId: search.account }),
    ...(category?.type === "system" ? { categoryCode: category.code } : {}),
    ...(category?.type === "custom" ? { categoryId: category.id } : {}),
    ...(search.type === undefined ? {} : { type: search.type }),
    ...(min === undefined ? {} : { amountFrom: Math.abs(min) }),
    ...(max === undefined ? {} : { amountTo: Math.abs(max) }),
    ...(search.source === undefined ? {} : { source: search.source }),
  };
}

/** Заданы ли фильтры (кроме страницы и открытой карточки): пустой список с ними — «ничего не нашлось». */
export function hasFilters(search: OperationsSearch): boolean {
  return (
    search.q !== undefined ||
    search.type !== undefined ||
    search.from !== undefined ||
    search.to !== undefined ||
    search.account !== undefined ||
    search.category !== undefined ||
    search.min !== undefined ||
    search.max !== undefined ||
    search.source !== undefined
  );
}
