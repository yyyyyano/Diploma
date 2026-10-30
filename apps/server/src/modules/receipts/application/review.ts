// Чек на экране и в учёте (RCPT-07, RCPT-08, RCPT-10, RCPT-11, TXN-01): вкладка, карточка, «Верно» / «Изменить» /
// «Отменить». Чек сохранён сразу (P5), а человек подтверждает, правит позиции или отменяет. Правка пересчитывает статус тем
// же валидатором, что и распознавание, а числа — только код (P1). «Отменить» удаляет чек вместе с его операцией и фото.
import type { ReceiptCard, ReceiptItem, ReceiptItemEdit } from "@kosht/contract";
import { CategoryId, SystemCategoryCode, type CategoryRef } from "@kosht/contract";
import { Money } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { CategoriesFacade } from "../../categories/index.ts";
import type { ExplainFacade } from "../../explain/index.ts";
import type { FilesFacade } from "../../files/index.ts";
import type { MerchantsFacade } from "../../merchants/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";
import { checkReceipt } from "../domain/read-receipt.ts";
import type { ReadItem } from "../domain/types.ts";
import {
  deleteReceipt,
  findReceipt,
  findReceipts,
  insertAttempt,
  listAttempts,
  listItems,
  listReceipts,
  lockReceipt,
  replaceItems,
  updateReceipt,
  type ItemRow,
  type NewItem,
  type ReceiptRow,
} from "../infrastructure/db/receipts.repo.ts";
import { RECEIPTS_TOLERANCE_MINOR } from "../settings.ts";
import { ENTITY } from "./recognize.ts";
import { makeOperationPlan } from "./operation-plan.ts";
import { toCard, toItem, toSummary } from "./receipt-card.ts";

/** Сколько чеков показывает вкладка. */
const LIST_LIMIT = 50;

export interface ReviewDeps {
  readonly platform: Pick<Platform, "clock" | "log" | "events" | "realtime" | "settings">;
  readonly files: Pick<FilesFacade, "remove">;
  readonly categories: Pick<CategoriesFacade, "categorize">;
  readonly explain: Pick<ExplainFacade, "save">;
  readonly merchants: Pick<MerchantsFacade, "normalizeItemName">;
  readonly transactions: Pick<
    TransactionsFacade,
    "updateFromReceipt" | "setReceiptReviewed" | "removeForReceipt" | "operationOfReceipt"
  >;
}

const categoryOf = (row: ItemRow): CategoryRef | null => {
  if (row.categoryCode !== null) {
    return { type: "system", code: SystemCategoryCode.parse(row.categoryCode) };
  }
  return row.categoryId === null ? null : { type: "custom", id: CategoryId.parse(row.categoryId) };
};

export function makeReview(d: ReviewDeps) {
  const { clock, settings, realtime } = d.platform;
  const plan = makeOperationPlan(d);
  const changed = (tx: ScopedDb, id: string) => realtime.changed(tx, { entity: ENTITY, ids: [id] });

  async function own(s: ScopedDb, id: string): Promise<ReceiptRow> {
    const row = await findReceipt(s, id);
    if (row === undefined) throw new AppError("NOT_FOUND");
    return row;
  }

  async function card(s: ScopedDb, row: ReceiptRow): Promise<ReceiptCard> {
    const [items, attempts, operation, original] = await Promise.all([
      listItems(s, row.id),
      listAttempts(s, row.id),
      d.transactions.operationOfReceipt(s, row.id),
      row.duplicateOf === null ? undefined : findReceipt(s, row.duplicateOf),
    ]);
    const dtoItems: ReceiptItem[] = items.map((item) =>
      toItem(item, row.currency, categoryOf(item)),
    );
    return toCard({ row, items: dtoItems, attempts, original, operation });
  }

  async function get(s: ScopedDb, id: string): Promise<ReceiptCard> {
    return card(s, await own(s, id));
  }

  /** Вкладка чеков: новые сверху; прежние чеки дублей читаются одним запросом. */
  async function list(s: ScopedDb) {
    const rows = await listReceipts(s, LIST_LIMIT);
    const originals = new Map(
      (
        await findReceipts(
          s,
          rows.flatMap((row) => (row.duplicateOf === null ? [] : [row.duplicateOf])),
        )
      ).map((row) => [row.id, row]),
    );
    return rows.map((row) =>
      toSummary(row, row.duplicateOf === null ? undefined : originals.get(row.duplicateOf)),
    );
  }

  /** «Верно» (RCPT-08): чек подтверждён, у операции снят признак «требует проверки». «Не вышло» подтверждать нечего. */
  async function confirm(s: ScopedDb, id: string): Promise<ReceiptCard> {
    await s.transaction(async (tx) => {
      const row = await lockReceipt(tx, id);
      if (row === undefined) throw new AppError("NOT_FOUND");
      if (row.status !== "ok" && row.status !== "needs-review") throw new AppError("CONFLICT");
      await updateReceipt(tx, id, { confirmedAt: clock.now(), updatedAt: clock.now() });
      await d.transactions.setReceiptReviewed(tx, id, false);
      await changed(tx, id);
    });
    return get(s, id);
  }

  function readItemOf(edit: ReceiptItemEdit, currency: string): ReadItem {
    for (const money of [edit.unitPrice, edit.discount, edit.lineTotal]) {
      if (money.currency !== currency) throw new AppError("VALIDATION", { reason: "currency" });
    }
    return {
      name: edit.name,
      unit: null,
      quantityMilli: edit.quantityMilli,
      unitPrice: edit.unitPrice,
      discount: Money.of(Math.abs(edit.discount.minor), currency),
      lineTotal: edit.lineTotal,
    };
  }

  /**
   * «Изменить» (RCPT-08): позиции целиком, статус и расхождения пересчитывает валидатор, категории и операция чека
   * обновляются. Наименования единицы измерения при правке не меняются — берутся из прежней строки той же позиции.
   */
  async function updateItems(
    s: ScopedDb,
    id: string,
    input: {
      readonly items: readonly ReceiptItemEdit[];
      readonly total: Money;
      readonly receiptDiscount: Money;
    },
  ): Promise<ReceiptCard> {
    const row = await own(s, id);
    if (row.status !== "ok" && row.status !== "needs-review") throw new AppError("CONFLICT");
    const { currency } = row;
    if (input.total.currency !== currency || input.receiptDiscount.currency !== currency) {
      throw new AppError("VALIDATION", { reason: "currency" });
    }
    if (input.total.minor <= 0) throw new AppError("VALIDATION", { reason: "total" });
    const previous = await listItems(s, id);
    const items = input.items.map((edit, index) => ({
      ...readItemOf(edit, currency),
      unit: previous[index]?.unit ?? null,
    }));
    const toleranceMinor = await settings.get(RECEIPTS_TOLERANCE_MINOR);
    const read = checkReceipt(
      items,
      Money.of(Math.abs(input.receiptDiscount.minor), currency),
      input.total,
      { currency, toleranceMinor },
    );
    const status = read.ok ? "ok" : "needs-review";
    const planned = await plan(s, {
      read,
      currency,
      merchant: { name: row.storeName, key: row.storeKey },
      date: row.purchaseDate ?? clock.today().toString(),
      time: row.purchaseTime,
      method: row.paymentMethod,
      cardLast4: row.cardLast4,
    });
    const disputedLines = read.mismatches.flatMap((m) => (m.kind === "line" ? [m.line] : []));
    const remainderMinor = read.validation.total.ok
      ? 0
      : read.validation.total.difference.value.minor;
    await s.transaction(async (tx) => {
      const current = await lockReceipt(tx, id);
      if (current === undefined) throw new AppError("NOT_FOUND");
      const traceId = await d.explain.save(tx, read.validation.total.difference);
      const attempts = await listAttempts(tx, id);
      await updateReceipt(tx, id, {
        status,
        totalMinor: read.total.minor,
        receiptDiscountMinor: read.receiptDiscount.minor,
        disputedLines,
        mismatches: [...read.mismatches],
        remainderMinor,
        traceId,
        // Правка человека — новое состояние чека: подтверждение «Верно» нужно заново.
        confirmedAt: null,
        updatedAt: clock.now(),
      });
      const rows: NewItem[] = read.items.map((item, index) => ({
        position: index + 1,
        name: item.name,
        normalizedName: d.merchants.normalizeItemName(item.name),
        unit: item.unit,
        quantityMilli: item.quantityMilli,
        unitPriceMinor: item.unitPrice?.minor ?? null,
        discountMinor: item.discount.minor,
        lineTotalMinor: item.lineTotal?.minor ?? null,
        disputed: disputedLines.includes(index + 1),
        categoryCode: planned.items[index]?.category.code ?? null,
        categoryId: planned.items[index]?.category.id ?? null,
        warranty: planned.items[index]?.warranty ?? false,
      }));
      await replaceItems(tx, id, rows);
      await insertAttempt(tx, id, {
        attempt: (attempts.at(-1)?.attempt ?? 0) + 1,
        askedLines: [],
        changedLines: [],
        ok: read.ok,
        mismatches: [...read.mismatches],
      });
      if (planned.operation !== undefined) {
        await d.transactions.updateFromReceipt(tx, {
          ...planned.operation,
          receiptId: id,
          needsReview: status === "needs-review",
        });
      }
      await changed(tx, id);
    });
    return get(s, id);
  }

  /** «Отменить» (RCPT-08): чек, его операция и фото удаляются; остаток «Наличных» возвращается. */
  async function cancel(s: ScopedDb, id: string): Promise<void> {
    const row = await own(s, id);
    await s.transaction(async (tx) => {
      await d.transactions.removeForReceipt(tx, id);
      await deleteReceipt(tx, id);
      await changed(tx, id);
    });
    // Файл удаляется после транзакции (файлы — не внутри s.transaction); дубль делит файл со своим «первым» только по содержимому, не по id.
    await d.files.remove(s, row.fileId as Parameters<FilesFacade["remove"]>[1]);
  }

  return { list, get, confirm, updateItems, cancel };
}

export type Review = ReturnType<typeof makeReview>;
