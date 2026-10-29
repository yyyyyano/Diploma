// Строка БД → форма «на проводе» и состояния для истории (TXN-01, TXN-05). DTO ≠ строка: без владельца, ключа
// контрагента и служебных полей; время «08:47:00» → «08:47», номер строки цепляется брендом.
import {
  AccountId,
  CategoryId,
  SystemCategoryCode,
  TransactionId,
  type CategoryRef,
  type Transaction,
} from "@kosht/contract";
import { LocalDate, Money } from "@kosht/kernel";
import type { Direction, Snapshot, StoredState, TransactionType } from "../domain/transactions.ts";
import { shortTime } from "../domain/transactions.ts";
import type { TransactionRow } from "../infrastructure/db/transactions.repo.ts";

export function categoryRefOf(row: {
  categoryCode: string | null;
  categoryId: string | null;
}): CategoryRef | null {
  if (row.categoryCode !== null) {
    return { type: "system", code: SystemCategoryCode.parse(row.categoryCode) };
  }
  if (row.categoryId !== null) return { type: "custom", id: CategoryId.parse(row.categoryId) };
  return null;
}

export function toDto(row: TransactionRow): Transaction {
  return {
    id: TransactionId.parse(row.id),
    accountId: AccountId.parse(row.accountId),
    type: row.type as TransactionType,
    direction: row.direction as Direction,
    occurredOn: LocalDate.parse(row.occurredOn),
    occurredTime: shortTime(row.occurredTime),
    amount: Money.of(row.amountMinor, row.currency),
    amountInByn: row.amountBynMinor === null ? null : Money.of(row.amountBynMinor, "BYN"),
    description: row.description,
    merchantName: row.merchantName,
    note: row.note,
    category: categoryRefOf(row),
    categorySource: row.categorySource as Transaction["categorySource"],
    source: row.source as Transaction["source"],
    visibility: row.visibility as Transaction["visibility"],
    transferPairId: row.transferPairId === null ? null : TransactionId.parse(row.transferPairId),
    refundOfId: row.refundOfId === null ? null : TransactionId.parse(row.refundOfId),
    version: row.version,
  };
}

/** Сравниваемые поля (история изменений, «что поменялось»). */
export function snapshotOf(row: TransactionRow): Snapshot {
  return {
    accountId: row.accountId,
    type: row.type as TransactionType,
    direction: row.direction as Direction,
    occurredOn: row.occurredOn,
    occurredTime: row.occurredTime,
    amountMinor: row.amountMinor,
    currency: row.currency,
    amountBynMinor: row.amountBynMinor,
    fxRateId: row.fxRateId,
    merchantName: row.merchantName,
    merchantKey: row.merchantKey,
    note: row.note,
    categoryCode: row.categoryCode,
    categoryId: row.categoryId,
    categorySource: row.categorySource,
  };
}

/** Состояние «до» для ревизии: всё, чтобы вернуть правку или воссоздать удалённую операцию. */
export function stateOf(row: TransactionRow): StoredState {
  return {
    ...snapshotOf(row),
    description: row.description,
    source: row.source,
    visibility: row.visibility,
    transferPairId: row.transferPairId,
    refundOfId: row.refundOfId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}
