// Строки БД → форма «на проводе» (RCPT-07, RCPT-08, RCPT-11, RCPT-12): карточка чека, строка вкладки. DTO ≠ строка БД:
// без владельца и служебных полей; расхождения — суммы вместо копеек, без наименований; день дубля «12.10» считается здесь.
import {
  ReceiptId,
  type ReceiptCard,
  type ReceiptItem,
  type ReceiptMismatch,
  type ReceiptSummary,
} from "@kosht/contract";
import { DEFAULT_TIME_ZONE, LocalDate, Money } from "@kosht/kernel";
import type { Mismatch } from "../domain/types.ts";
import type { AttemptRow, ItemRow, ReceiptRow } from "../infrastructure/db/receipts.repo.ts";

/** День «12.10» для «Этот чек уже загружен 12.10» (RCPT-04): день первой загрузки по поясу системы. */
export function shortDay(at: Date): string {
  const [, month = "", day = ""] = LocalDate.fromInstant(at, DEFAULT_TIME_ZONE).split("-");
  return `${day}.${month}`;
}

const money = (minor: number | null, currency: string) =>
  minor === null ? null : Money.of(minor, currency);

export function toSummary(row: ReceiptRow, original?: ReceiptRow): ReceiptSummary {
  return {
    id: ReceiptId.parse(row.id),
    status: row.status,
    stage: row.stage,
    disputedLines: row.disputedLines,
    errorCode: row.errorCode,
    duplicateOf:
      row.duplicateOf === null || original === undefined
        ? null
        : { id: ReceiptId.parse(original.id), date: shortDay(original.createdAt) },
    storeName: row.storeName,
    purchaseDate: row.purchaseDate === null ? null : LocalDate.parse(row.purchaseDate),
    purchaseTime: row.purchaseTime === null ? null : row.purchaseTime.slice(0, 5),
    total: money(row.totalMinor, row.currency),
    confirmed: row.confirmedAt !== null,
    rechecks: row.rechecks,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMismatch(mismatch: Mismatch, currency: string): ReceiptMismatch {
  const arithmetic = mismatch.reason === "arithmetic";
  const expected = arithmetic ? Money.of(mismatch.expectedMinor, currency) : null;
  const printed = arithmetic ? Money.of(mismatch.printedMinor, currency) : null;
  return mismatch.kind === "line"
    ? { kind: "line", line: mismatch.line, reason: mismatch.reason, expected, printed }
    : { kind: "total", reason: mismatch.reason, expected, printed };
}

export function toItem(
  row: ItemRow,
  currency: string,
  category: ReceiptItem["category"],
): ReceiptItem {
  return {
    position: row.position,
    name: row.name,
    normalizedName: row.normalizedName,
    unit: row.unit,
    quantityMilli: row.quantityMilli,
    unitPrice: money(row.unitPriceMinor, currency),
    discount: Money.of(row.discountMinor, currency),
    lineTotal: money(row.lineTotalMinor, currency),
    disputed: row.disputed,
    category,
    warranty: row.warranty,
  };
}

export interface CardParts {
  readonly row: ReceiptRow;
  readonly items: readonly ReceiptItem[];
  readonly attempts: readonly AttemptRow[];
  readonly original: ReceiptRow | undefined;
  readonly operation:
    | { id: string; accountId: string; pending: boolean; source: string }
    | undefined;
}

export function toCard(parts: CardParts): ReceiptCard {
  const { row } = parts;
  return {
    receipt: toSummary(row, parts.original),
    unp: row.unp,
    address: row.address,
    payment:
      row.paymentMethod === null ? null : { method: row.paymentMethod, last4: row.cardLast4 },
    receiptDiscount: Money.of(row.receiptDiscountMinor, row.currency),
    remainder: Money.of(row.remainderMinor, row.currency),
    mismatches: row.mismatches.map((mismatch) => toMismatch(mismatch, row.currency)),
    items: [...parts.items],
    attempts: parts.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      askedLines: attempt.askedLines,
      changedLines: attempt.changedLines,
      ok: attempt.ok,
    })),
    fileId: row.fileId,
    operation:
      parts.operation === undefined
        ? null
        : {
            id: parts.operation.id,
            accountId: parts.operation.accountId,
            pending: parts.operation.pending,
            merged: parts.operation.source !== "receipt",
          },
    mns:
      row.uid === null
        ? null
        : {
            uid: row.uid,
            date: row.purchaseDate === null ? null : LocalDate.parse(row.purchaseDate),
          },
    traceId: row.traceId,
  };
}
