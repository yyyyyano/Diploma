// Запись готового чтения чека без модели и без фото-распознавания (DEMO-01, DEMO-02): демо-пользователю нужны чеки, у
// которых статус «сходится», «перепроверка» и «требует проверки» получились так же, как у настоящих — арифметикой
// валидатора (RCPT-05), перепроверкой спорных строк (RCPT-06) и теми же планом операции и транзакцией (`settle`). Вместо
// модели — заранее заданные чтение и ответы перепроверки; категории позиций заданы явно (источник «user»), поэтому ни
// `categories.categorize`, ни шлюз `llm` не вызываются и лимиты не тратятся. Фото чека — файл, который уже сохранил вызывающий.
import type { FileId } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { MerchantsFacade } from "../../merchants/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";
import { parsePrintedDate, parsePrintedMoney, parsePrintedTime } from "../domain/printed.ts";
import { applyRecheck, askedOf, type RecheckAnswer } from "../domain/recheck.ts";
import { readItems, readReceipt } from "../domain/read-receipt.ts";
import type { PrintedReceipt } from "../domain/types.ts";
import { insertReceipt, isUniqueViolation } from "../infrastructure/db/receipts.repo.ts";
import { RECEIPTS_MAX_RECHECKS, RECEIPTS_TOLERANCE_MINOR } from "../settings.ts";
import { composePlan } from "./operation-plan.ts";
import type { Attempt, Recognize } from "./recognize.ts";
import type { ReceiptExtraction } from "./receipt-extraction.ts";

/** Готовое чтение: то, что «прочитала бы» модель, ответы перепроверки по порядку и категории позиций. */
export interface ReadyReceipt {
  /** Фото чека (`receipt-photo`): уже сохранено в `files`. */
  readonly fileId: FileId;
  readonly reading: ReceiptExtraction;
  /** Ответы перепроверки: применяются, пока чек не сойдётся, но не больше настройки `max-rechecks`. */
  readonly rechecks: readonly RecheckAnswer[];
  /** Код встроенной категории каждой позиции по порядку чтения. */
  readonly categories: readonly string[];
}

export interface RecordReadyDeps {
  readonly platform: Pick<Platform, "clock" | "log" | "settings">;
  readonly merchants: Pick<MerchantsFacade, "resolve">;
  readonly transactions: Pick<TransactionsFacade, "matchReceipt">;
  readonly settle: Recognize["settle"];
}

export function makeRecordReady(d: RecordReadyDeps) {
  const { log, settings } = d.platform;

  return async function recordReady(
    s: ScopedDb,
    input: ReadyReceipt,
  ): Promise<{ id: string; status: "ok" | "needs-review" }> {
    const { reading } = input;
    if (input.categories.length !== reading.items.length) {
      throw new AppError("VALIDATION", { reason: "categories" });
    }
    const currency = reading.currency ?? "BYN";
    const toleranceMinor = await settings.get(RECEIPTS_TOLERANCE_MINOR);
    const maxRechecks = await settings.get(RECEIPTS_MAX_RECHECKS);

    // RCPT-05, RCPT-06: тот же путь, что у распознавания, только ответы перепроверки готовые.
    let printed: PrintedReceipt = {
      items: reading.items,
      receiptDiscount: reading.receiptDiscount,
      total: reading.total,
    };
    const check = (value: PrintedReceipt) =>
      readReceipt(value, readItems(value, currency), { currency, toleranceMinor });
    let read = check(printed);
    const attempts: Attempt[] = [
      { attempt: 0, askedLines: [], changedLines: [], ok: read.ok, mismatches: read.mismatches },
    ];
    for (const answer of input.rechecks.slice(0, maxRechecks)) {
      if (read.ok) break;
      const asked = askedOf(read.mismatches);
      const merged = applyRecheck(printed, answer, asked);
      printed = merged.printed;
      read = check(printed);
      attempts.push({
        attempt: attempts.length,
        askedLines: asked.lines,
        changedLines: merged.changedLines,
        ok: read.ok,
        mismatches: read.mismatches,
      });
    }

    const store = reading.store?.trim() ?? "";
    const merchant = store === "" ? undefined : (await d.merchants.resolve([store]))[0];
    const date = reading.date === null ? undefined : parsePrintedDate(reading.date);
    const time = reading.time === null ? undefined : parsePrintedTime(reading.time);
    let row;
    try {
      row = await s.transaction((tx) =>
        insertReceipt(tx, { fileId: input.fileId, status: "processing", uid: reading.uid }),
      );
    } catch (error) {
      // RCPT-04: тот же УИ во второй раз — это уже сохранённый чек, а не ещё один.
      if (isUniqueViolation(error)) throw new AppError("CONFLICT", { reason: "receipt-duplicate" });
      throw error;
    }
    const { status } = await d.settle(s, row.id, {
      read,
      attempts,
      currency,
      store,
      merchant,
      date,
      time,
      printedTotal: parsePrintedMoney(printed.total, currency),
      header: {
        unp: reading.unp,
        address: reading.address,
        payment: reading.payment,
        cardLast4: reading.payment === "card" ? reading.cardLast4 : null,
      },
      plan: async (_s, planInput) =>
        composePlan(
          planInput,
          input.categories.map((code) => ({ category: { code }, source: "user" })),
        ),
    });
    // TXN-10: платёж по карте ищется так же, как у распознанного чека; сбой сопоставления чек не портит.
    await d.transactions.matchReceipt(s, row.id).catch((error: unknown) => {
      log.warn(
        { receiptId: row.id, code: error instanceof AppError ? error.code : "INTERNAL" },
        "receipt.match-failed",
      );
    });
    log.info({ receiptId: row.id, status, attempt: attempts.length - 1 }, "receipt.recorded-ready");
    return { id: row.id, status };
  };
}

export type RecordReady = ReturnType<typeof makeRecordReady>;
