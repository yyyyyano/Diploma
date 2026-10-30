// Запись операций выписки одной пачкой (STMT-03…STMT-11, ARCHITECTURE §11.2 шаг 4): вызывает statements в своей
// транзакции импорта. Всё, что ходит наружу — курс НБРБ, категория моделью, контрагент — statements подготовил до
// транзакции; здесь только запись: операции, пары переводов, «Наличные» для снятия, связь возврата с покупкой, история,
// сдвиг остатков счетов и одно событие transactions.changed со всеми id. Откат импорта — deleteImport.
import { Money } from "@kosht/kernel";
import { randomUUID } from "node:crypto";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { toDbTime, type Direction, type TransactionType } from "../domain/transactions.ts";
import {
  deleteTransactions,
  existingDedupeKeys,
  existingExternalIds,
  insertTransaction,
  lockByImport,
  purchasesOf,
  unpairedTransfers,
  updateTransaction,
  type TransactionRow,
} from "../infrastructure/db/transactions.repo.ts";
import type { Deps, Parts } from "./deps.ts";
import type { Change } from "./ledger.ts";

/** Операция выписки, уже подготовленная для записи. */
export interface ImportRow {
  readonly accountId: string;
  readonly type: TransactionType;
  readonly direction: Direction;
  readonly occurredOn: string;
  readonly occurredTime?: string | undefined;
  /** Сумма в валюте счёта, положительная. */
  readonly amount: Money;
  readonly amountBynMinor: number | null;
  readonly fxRateId: string | null;
  readonly description: string;
  readonly merchantName: string | null;
  readonly merchantKey: string | null;
  /** Встроенная (code) или своя (id) категория и откуда она; у перевода — null. */
  readonly category: {
    readonly code?: string;
    readonly id?: string;
    readonly source: string;
  } | null;
  readonly dedupeKey: string;
  readonly externalId?: string | undefined;
  /** Перевод: пара — уже записанный перевод без пары на другом счёте. */
  readonly pairWithId?: string | undefined;
  /** Снятие/внесение наличных: создать встречную операцию на «Наличные» (BYN). */
  readonly cashCounterpart?: boolean | undefined;
  /** Возврат: покупка — уже записанная операция или строка этой же пачки (по номеру). */
  readonly refundOfId?: string | undefined;
  readonly refundOfIndex?: number | undefined;
}

export interface ImportInput {
  readonly importId: string;
  readonly rows: readonly ImportRow[];
}

export interface ImportResult {
  /** Id пачки ревизий (история операций). */
  readonly batchId: string;
  /** Id записанных операций в порядке входа (встречные «Наличные» — в конце). */
  readonly ids: readonly string[];
  readonly cashCounterparts: number;
}

export function makeImportBatch(d: Deps, parts: Parts) {
  /** Записать операции выписки; одна пачка ревизий и одно событие на весь импорт. */
  async function importBatch(tx: ScopedDb, input: ImportInput): Promise<ImportResult> {
    const batchId = randomUUID();
    // Повторная загрузка той же выписки: записывать нечего, события «изменилось» нет.
    if (input.rows.length === 0) return { batchId, ids: [], cashCounterparts: 0 };
    const created: TransactionRow[] = [];
    const counterparts: TransactionRow[] = [];
    for (const row of input.rows) {
      const inserted = await insertTransaction(tx, {
        accountId: row.accountId,
        type: row.type,
        direction: row.direction,
        occurredOn: row.occurredOn,
        occurredTime: toDbTime(row.occurredTime ?? null),
        amountMinor: row.amount.minor,
        currency: row.amount.currency,
        amountBynMinor: row.amountBynMinor,
        fxRateId: row.fxRateId,
        description: row.description,
        merchantName: row.merchantName,
        merchantKey: row.merchantKey,
        categoryCode: row.category?.code ?? null,
        categoryId: row.category?.id ?? null,
        categorySource: row.category?.source ?? null,
        source: "statement",
        importId: input.importId,
        externalId: row.externalId ?? null,
        dedupeKey: row.dedupeKey,
      });
      created.push(inserted);
    }
    // Связи: пара с уже записанным переводом, встречная операция на «Наличные», покупка возврата.
    let cashId: string | undefined;
    for (const [index, row] of input.rows.entries()) {
      const own = created[index];
      if (own === undefined) continue;
      if (row.pairWithId !== undefined) {
        await updateTransaction(tx, own.id, { transferPairId: row.pairWithId });
        await updateTransaction(tx, row.pairWithId, { transferPairId: own.id });
      }
      if (row.cashCounterpart === true && row.amount.currency === "BYN") {
        cashId ??= await d.accounts.cash(tx);
        const other = await insertTransaction(tx, {
          accountId: cashId,
          type: "transfer",
          direction: row.direction === "out" ? "in" : "out",
          occurredOn: row.occurredOn,
          occurredTime: toDbTime(row.occurredTime ?? null),
          amountMinor: row.amount.minor,
          currency: "BYN",
          amountBynMinor: row.amount.minor,
          fxRateId: null,
          description: row.description,
          categoryCode: null,
          categoryId: null,
          categorySource: null,
          source: "statement",
          importId: input.importId,
          transferPairId: own.id,
        });
        await updateTransaction(tx, own.id, { transferPairId: other.id });
        counterparts.push(other);
      }
      const refundOf =
        row.refundOfId ??
        (row.refundOfIndex === undefined ? undefined : created[row.refundOfIndex]?.id);
      if (refundOf !== undefined) await updateTransaction(tx, own.id, { refundOfId: refundOf });
    }
    const all = [...created, ...counterparts];
    // Строки с проставленными связями — как записаны в базе (версия не менялась: это ещё создание).
    const ids = all.map((row) => row.id);
    const fresh = new Map((await lockByImport(tx, input.importId)).map((row) => [row.id, row]));
    const changes: Change[] = ids.flatMap((id) => {
      const after = fresh.get(id);
      return after === undefined ? [] : [{ after }];
    });
    await parts.ledger.settle(tx, { batchId, channel: "web", changes });
    // Курс, которого не нашлось, досчитает фон (как после ручного ввода).
    const missing = created.filter((row) => row.amountBynMinor === null && row.currency !== "BYN");
    if (missing.length > 0) {
      await d.platform.jobs.enqueue(tx, parts.jobs.fillRates, {
        ids: missing.map((row) => row.id),
      });
    }
    d.platform.log.info({ count: ids.length }, "transactions.imported");
    return { batchId, ids, cashCounterparts: counterparts.length };
  }

  /** STMT-11: удалить все операции импорта (правленные вручную — тоже), остатки счетов сдвигаются обратно. */
  async function deleteImport(tx: ScopedDb, importId: string): Promise<number> {
    const rows = await lockByImport(tx, importId);
    if (rows.length === 0) return 0;
    await deleteTransactions(
      tx,
      rows.map((row) => row.id),
    );
    await parts.ledger.settle(tx, {
      batchId: randomUUID(),
      channel: "web",
      changes: rows.map((before) => ({ before })),
    });
    d.platform.log.info({ count: rows.length }, "transactions.import-deleted");
    return rows.length;
  }

  /** STMT-07: какие ключи дубля и банковские идентификаторы уже загружены. */
  async function knownKeys(
    s: ScopedDb,
    keys: { readonly dedupeKeys: readonly string[]; readonly externalIds: readonly string[] },
  ): Promise<{ dedupe: Set<string>; external: Set<string> }> {
    return {
      dedupe: await existingDedupeKeys(s, keys.dedupeKeys),
      external: await existingExternalIds(s, keys.externalIds),
    };
  }

  /** STMT-08: переводы без пары на других счетах за окно — для пары новому переводу. */
  async function transferCandidates(
    s: ScopedDb,
    filter: { from: string; to: string; excludeAccountIds: readonly string[] },
  ) {
    const rows = await unpairedTransfers(s, filter);
    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      date: row.occurredOn,
      direction: row.direction as Direction,
      minor: row.amountMinor,
      currency: row.currency,
    }));
  }

  /** STMT-08: расходы тех же контрагентов за окно — для связи возврата с покупкой. */
  async function purchaseCandidates(
    s: ScopedDb,
    filter: { merchantKeys: readonly string[]; from: string; to: string },
  ) {
    const rows = await purchasesOf(s, filter);
    return rows.map((row) => ({
      id: row.id,
      date: row.occurredOn,
      merchantKey: row.merchantKey,
      minor: row.amountMinor,
      currency: row.currency,
    }));
  }

  return { importBatch, deleteImport, knownKeys, transferCandidates, purchaseCandidates };
}
