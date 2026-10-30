// Операция от чека (RCPT-08…10, TXN-01, TXN-10, P5): чек сохраняется сразу — receipts зовёт эти сценарии в своей
// транзакции. Оплата наличными (или способ неизвестен) — трата со счёта «Наличные»; оплата картой — предварительная
// операция «ожидает выписки» на счёте карты по последним цифрам (нет такого счёта — на «Карта, не указана»): в тратах
// она учитывается, остаток счёта не меняет (ledger пропускает pending). У операции — разбивка по категориям позиций
// (`transaction_splits`): агрегации распределяют траты по ней. Слитая с операцией банка (T-029) остаётся операцией
// банка: чек даёт ей только разбивку и ссылку.
import { Money } from "@kosht/kernel";
import { randomUUID } from "node:crypto";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import {
  deleteTransactions,
  findByReceipt,
  insertTransaction,
  replaceSplits,
  updateTransaction,
  type NewSplit,
  type TransactionRow,
} from "../infrastructure/db/transactions.repo.ts";
import { Snapshot } from "./merged-snapshot.ts";
import type { Deps, Parts } from "./deps.ts";

/** Категория как в строке БД: встроенная по коду или своя по id. */
export interface StoredCategory {
  readonly code?: string;
  readonly id?: string;
}

export interface ReceiptSplit {
  readonly category: StoredCategory;
  /** Сумма части в валюте операции, больше нуля. */
  readonly amount: Money;
}

export interface ReceiptOperation {
  readonly receiptId: string;
  /** Способ оплаты с чека: нет или «наличные» — со счёта «Наличные», «карта» — предварительная операция. */
  readonly method: "cash" | "card" | null;
  readonly cardLast4: string | null;
  readonly occurredOn: string;
  readonly occurredTime: string | null;
  /** Итог чека: сумма операции. */
  readonly amount: Money;
  readonly merchantName: string | null;
  readonly merchantKey: string | null;
  /** Категория операции (самая крупная часть разбивки) и откуда она. */
  readonly category: StoredCategory & { readonly source: string };
  readonly splits: readonly ReceiptSplit[];
  /** «Требует проверки» (TXN-01). */
  readonly needsReview: boolean;
}

const splitRows = (splits: readonly ReceiptSplit[]): NewSplit[] =>
  splits.map((split, index) => ({
    position: index + 1,
    categoryCode: split.category.code ?? null,
    categoryId: split.category.id ?? null,
    amountMinor: split.amount.minor,
  }));

export function makeReceiptOps(d: Deps, parts: Parts) {
  const { ledger } = parts;

  /** Счёт операции: карта по цифрам (если такой счёт известен и один), иначе «Карта, не указана»; наличные — «Наличные». */
  async function accountFor(
    tx: ScopedDb,
    input: ReceiptOperation,
  ): Promise<{ accountId: string; pending: boolean }> {
    if (input.method !== "card") return { accountId: await d.accounts.cash(tx), pending: false };
    const known =
      input.cardLast4 === null
        ? undefined
        : await d.accounts.findCardByMask(tx, {
            mask: input.cardLast4,
            currency: input.amount.currency,
          });
    return { accountId: known ?? (await d.accounts.unknownCard(tx)), pending: true };
  }

  /** RCPT-08, RCPT-10: операция от нового чека. Возвращает id операции и признак «ожидает выписки». */
  async function recordFromReceipt(
    tx: ScopedDb,
    input: ReceiptOperation,
  ): Promise<{ id: string; pending: boolean }> {
    const existing = await findByReceipt(tx, input.receiptId);
    if (existing !== undefined) return { id: existing.id, pending: existing.pending };
    const { accountId, pending } = await accountFor(tx, input);
    const created = await insertTransaction(tx, {
      accountId,
      type: "expense",
      direction: "out",
      occurredOn: input.occurredOn,
      occurredTime: input.occurredTime,
      amountMinor: input.amount.minor,
      currency: input.amount.currency,
      amountBynMinor: input.amount.currency === "BYN" ? input.amount.minor : null,
      description: input.merchantName ?? "",
      merchantName: input.merchantName,
      merchantKey: input.merchantKey,
      categoryCode: input.category.code ?? null,
      categoryId: input.category.id ?? null,
      categorySource: input.category.source,
      source: "receipt",
      receiptId: input.receiptId,
      pending,
      needsReview: input.needsReview,
    });
    await replaceSplits(tx, created.id, splitRows(input.splits));
    await ledger.settle(tx, {
      batchId: randomUUID(),
      channel: "system",
      changes: [{ after: created }],
    });
    return { id: created.id, pending };
  }

  /**
   * RCPT-08: правка позиций («Изменить») пересчитала чек — операция получает новую сумму, категорию и разбивку. Слитая с
   * операцией банка (источник не «чек») сумму и день не меняет: они из выписки; обновляются разбивка и признак.
   */
  async function updateFromReceipt(tx: ScopedDb, input: ReceiptOperation): Promise<void> {
    const row = await findByReceipt(tx, input.receiptId);
    if (row === undefined) return;
    const own = row.source === "receipt";
    const patch = own
      ? {
          occurredOn: input.occurredOn,
          occurredTime: input.occurredTime,
          amountMinor: input.amount.minor,
          amountBynMinor: input.amount.currency === "BYN" ? input.amount.minor : null,
          merchantName: input.merchantName,
          merchantKey: input.merchantKey,
          categoryCode: input.category.code ?? null,
          categoryId: input.category.id ?? null,
          categorySource: input.category.source,
          needsReview: input.needsReview,
          version: row.version + 1,
        }
      : { needsReview: input.needsReview };
    await updateTransaction(tx, row.id, patch);
    await replaceSplits(tx, row.id, splitRows(input.splits));
    const after: TransactionRow = { ...row, ...patch };
    await ledger.settle(tx, {
      batchId: randomUUID(),
      channel: "system",
      changes: [{ before: row, after }],
    });
  }

  /** Признак «требует проверки» без пересчёта (чек подтверждён: «Верно»). */
  async function setReceiptReviewed(
    tx: ScopedDb,
    receiptId: string,
    needsReview: boolean,
  ): Promise<void> {
    const row = await findByReceipt(tx, receiptId);
    if (row === undefined || row.needsReview === needsReview) return;
    await updateTransaction(tx, row.id, { needsReview });
    await ledger.settle(tx, {
      batchId: randomUUID(),
      channel: "system",
      changes: [{ before: row, after: { ...row, needsReview } }],
    });
  }

  /**
   * «Отменить» чек: операция чека удаляется (остаток «Наличных» возвращается), а слитая с банковской остаётся операцией
   * банка — снимаются только разбивка и ссылка на чек (TXN-10).
   */
  async function removeForReceipt(tx: ScopedDb, receiptId: string): Promise<void> {
    const row = await findByReceipt(tx, receiptId);
    if (row === undefined) return;
    if (row.source === "receipt") {
      await deleteTransactions(tx, [row.id]);
      await ledger.settle(tx, {
        batchId: randomUUID(),
        channel: "system",
        changes: [{ before: row }],
      });
      return;
    }
    // Слитая с чеком операция выписки возвращает собственные категорию и разбивку из снимка (как разрыв связи, TXN-11);
    // без снимка (связь до T-029) — разбивка снимается, как раньше.
    const snapshot = Snapshot.safeParse(row.mergedReceipt);
    const own = snapshot.success ? snapshot.data.bank : undefined;
    const patch = {
      receiptId: null,
      needsReview: false,
      mergedReceipt: null,
      ...(own === undefined
        ? {}
        : {
            categoryCode: own.categoryCode,
            categoryId: own.categoryId,
            categorySource: own.categorySource,
          }),
    };
    await replaceSplits(
      tx,
      row.id,
      own === undefined
        ? []
        : own.splits.map((split, index) => ({ ...split, position: index + 1 })),
    );
    await updateTransaction(tx, row.id, patch);
    await ledger.settle(tx, {
      batchId: randomUUID(),
      channel: "system",
      changes: [{ before: row, after: { ...row, ...patch } }],
    });
  }

  /** Операция чека (id, счёт, «ожидает выписки»); нет — undefined. */
  async function operationOfReceipt(
    s: ScopedDb,
    receiptId: string,
  ): Promise<{ id: string; accountId: string; pending: boolean; source: string } | undefined> {
    const row = await findByReceipt(s, receiptId);
    return row === undefined
      ? undefined
      : { id: row.id, accountId: row.accountId, pending: row.pending, source: row.source };
  }

  return {
    recordFromReceipt,
    updateFromReceipt,
    setReceiptReviewed,
    removeForReceipt,
    operationOfReceipt,
  };
}
