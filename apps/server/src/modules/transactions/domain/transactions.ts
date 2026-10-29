// Правила операций без БД (TXN-03, STMT-02, FIN-01): направление движения денег по типу, сдвиг остатков счетов от
// правки, «что изменилось» для истории. Числа — только @kosht/calc (P1).
import { node, sub, sum, type Calc } from "@kosht/calc";
import { Money } from "@kosht/kernel";

export type TransactionType = "expense" | "income" | "transfer" | "refund";
export type Direction = "in" | "out";

/** Расход уводит деньги со счёта, доход и возврат приводят; у перевода направление выбирают (по умолчанию — со счёта). */
export function directionOf(type: TransactionType, requested?: Direction): Direction {
  if (type === "transfer") return requested ?? "out";
  return type === "expense" ? "out" : "in";
}

/** Движение денег операции по счёту: сумма в валюте счёта и направление. */
export interface Movement {
  readonly accountId: string;
  readonly amount: Money;
  readonly direction: Direction;
}

function signed(movement: Movement, reverse: boolean): Calc<Money> {
  const amount = node("transactions.amount", movement.amount);
  const incoming = (movement.direction === "in") !== reverse;
  if (incoming) return amount;
  return sub(
    "transactions.balanceDelta",
    node("transactions.amount", Money.of(0, movement.amount.currency)),
    [amount],
  );
}

/**
 * STMT-02: на сколько меняются остатки счетов, когда движения `before` заменяются на `after` (создание — before пуст,
 * удаление — after пуст, перенос на другой счёт — по счёту на каждую сторону). Нулевые сдвиги не возвращаются.
 */
export function balanceDeltas(
  before: readonly Movement[],
  after: readonly Movement[],
): Map<string, Money> {
  const terms = new Map<string, Calc<Money>[]>();
  const add = (movement: Movement, reverse: boolean) => {
    const list = terms.get(movement.accountId) ?? [];
    list.push(signed(movement, reverse));
    terms.set(movement.accountId, list);
  };
  for (const movement of before) add(movement, true);
  for (const movement of after) add(movement, false);
  const deltas = new Map<string, Money>();
  for (const [accountId, list] of terms) {
    const [first, ...rest] = list;
    if (first === undefined) continue;
    const total = sum("transactions.balanceDelta", [first, ...rest]);
    if (total.value.minor !== 0) deltas.set(accountId, total.value);
  }
  return deltas;
}

/** Поля, которые показывает история изменений (TXN-05). */
export type Field =
  | "account"
  | "type"
  | "date"
  | "time"
  | "amount"
  | "amountInByn"
  | "merchant"
  | "note"
  | "category";

/** Состояние операции, которое сравнивают и восстанавливают «Отменить» и история. */
export interface Snapshot {
  readonly accountId: string;
  readonly type: TransactionType;
  readonly direction: Direction;
  readonly occurredOn: string;
  readonly occurredTime: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly amountBynMinor: number | null;
  readonly fxRateId: string | null;
  readonly merchantName: string | null;
  readonly merchantKey: string | null;
  readonly note: string | null;
  readonly categoryCode: string | null;
  readonly categoryId: string | null;
  readonly categorySource: string | null;
}

/** Какие поля отличаются у двух состояний (порядок — как в карточке). */
export function changedFields(before: Snapshot, after: Snapshot): Field[] {
  const fields: Field[] = [];
  if (before.accountId !== after.accountId) fields.push("account");
  if (before.type !== after.type || before.direction !== after.direction) fields.push("type");
  if (before.occurredOn !== after.occurredOn) fields.push("date");
  if (before.occurredTime !== after.occurredTime) fields.push("time");
  if (before.amountMinor !== after.amountMinor || before.currency !== after.currency) {
    fields.push("amount");
  }
  if (before.amountBynMinor !== after.amountBynMinor) fields.push("amountInByn");
  if (before.merchantName !== after.merchantName) fields.push("merchant");
  if (before.note !== after.note) fields.push("note");
  if (before.categoryCode !== after.categoryCode || before.categoryId !== after.categoryId) {
    fields.push("category");
  }
  return fields;
}

/** Время из БД «08:47:00» → «08:47»; нет — null. */
export function shortTime(time: string | null): string | null {
  return time === null ? null : time.slice(0, 5);
}

/** Полное состояние операции для истории и «Отменить»: сравниваемые поля и то, что нужно для восстановления удалённой. */
export interface StoredState extends Snapshot {
  readonly description: string;
  readonly source: string;
  readonly visibility: string;
  readonly transferPairId: string | null;
  readonly refundOfId: string | null;
  readonly version: number;
  /** Момент создания (ISO): удалённая операция возвращается с прежней датой записи. */
  readonly createdAt: string;
}

/**
 * Категории какого вида допустимы операции: расход — расходные, доход — доходные, возврат — любые (возврат покупки
 * остаётся в категории покупки, возврат налога — «Возвраты»), у перевода категории нет.
 */
export function categoryKindsOf(type: TransactionType): readonly ("expense" | "income")[] {
  if (type === "transfer") return [];
  if (type === "refund") return ["expense", "income"];
  return [type === "income" ? "income" : "expense"];
}

/** Вид категории для автоподбора: возврат покупки подбирается как расход. */
export function kindForRules(type: TransactionType): "expense" | "income" {
  return type === "income" ? "income" : "expense";
}

/** Время «08:47» → «08:47:00» (формат колонки time(0)); нет — null. */
export function toDbTime(time: string | null): string | null {
  return time === null ? null : `${time}:00`;
}
