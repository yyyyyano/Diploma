// Распознавание чека (RCPT-02…07, RCPT-14, NFR-21, P5, ARCHITECTURE §11.1): фото → QR и подготовка в изолированном
// потоке → дубль по УИ → модель с изображением читает чек → код разбирает числа и сверяет арифметику (calc) → спорные
// места перепроверяются (≤ N раз, настройка) → чек сохраняется с позициями, историей попыток и статусом. Модель и файлы —
// вне транзакции (LLM_IN_TRANSACTION), запись результата — одна короткая транзакция с событием. Текст на чеке — данные:
// наименование остаётся наименованием, а в подсказку перепроверки попадают только цифры, посчитанные программой.
import type { FileId } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { JobDef } from "../../../platform/jobs/define-job.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { CategoriesFacade } from "../../categories/index.ts";
import type { ExplainFacade } from "../../explain/index.ts";
import type { FilesFacade } from "../../files/index.ts";
import type { LlmFacade } from "../../llm/index.ts";
import type { MerchantsFacade } from "../../merchants/index.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";
import { parsePrintedDate, parsePrintedMoney, parsePrintedTime } from "../domain/printed.ts";
import { uidFromQr } from "../domain/qr.ts";
import { applyRecheck, askedOf } from "../domain/recheck.ts";
import {
  describeMismatches,
  readItems,
  readReceipt,
  type ReadReceipt,
} from "../domain/read-receipt.ts";
import type { Mismatch, PrintedReceipt, ReceiptStage } from "../domain/types.ts";
import { receiptsNeedsReview, receiptsRecognized, receiptsWarrantyItemsFound } from "../events.ts";
import {
  findByKey,
  findByUid,
  findReceipt,
  insertAttempt,
  insertReceipt,
  isUniqueViolation,
  lockReceipt,
  replaceItems,
  updateReceipt,
  type NewItem,
  type ReceiptRow,
} from "../infrastructure/db/receipts.repo.ts";
import {
  RECEIPTS_IMAGE_MAX_SIDE,
  RECEIPTS_MAX_RECHECKS,
  RECEIPTS_TOLERANCE_MINOR,
} from "../settings.ts";
import { makeOperationPlan, type PlannedItem } from "./operation-plan.ts";
import { PhotoReadError, type PhotoPreparer, type PhotoType } from "./ports.ts";
import {
  PROMPT_VERSION,
  RECEIPT_DOCUMENT,
  RECEIPT_INSTRUCTIONS,
  RECHECK_PROMPT_VERSION,
  ReceiptExtraction,
  ReceiptRecheck,
  recheckInstructions,
} from "./receipt-extraction.ts";

export const ENTITY = "receipt";
const DEFAULT_CURRENCY = "BYN";

const PHOTO_TYPES: Readonly<Record<string, PhotoType>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export interface RecognizeDeps {
  readonly platform: Pick<Platform, "clock" | "log" | "jobs" | "events" | "realtime" | "settings">;
  readonly files: Pick<FilesFacade, "open">;
  readonly llm: Pick<LlmFacade, "extract">;
  readonly merchants: Pick<MerchantsFacade, "resolve" | "normalizeItemName">;
  readonly explain: Pick<ExplainFacade, "save">;
  readonly categories: Pick<CategoriesFacade, "categorize">;
  readonly transactions: Pick<TransactionsFacade, "recordFromReceipt">;
  readonly notifications: Pick<NotificationsFacade, "notify">;
  readonly preparer: PhotoPreparer;
  readonly jobs: { readonly recognize: JobDef<{ receiptId: string }> };
}

interface Attempt {
  readonly attempt: number;
  readonly askedLines: readonly number[];
  readonly changedLines: readonly number[];
  readonly ok: boolean;
  readonly mismatches: readonly Mismatch[];
}

export function makeRecognize(d: RecognizeDeps) {
  const { clock, log, jobs, events, realtime, settings } = d.platform;

  const plan = makeOperationPlan(d);
  const changed = (tx: ScopedDb, id: string) => realtime.changed(tx, { entity: ENTITY, ids: [id] });
  const progress = (s: ScopedDb, id: string, percent: number) =>
    realtime.progress(s.scope, { entity: ENTITY, id, percent });

  /** Новая загрузка: чек «распознаётся» и задача — в одной транзакции (откат — нет ни того, ни другого). */
  async function start(s: ScopedDb, fileId: FileId): Promise<{ id: string }> {
    const file = await d.files.open(s, fileId);
    if (file.kind !== "receipt-photo") throw new AppError("VALIDATION", { reason: "file-kind" });
    return s.transaction(async (tx) => {
      const row = await insertReceipt(tx, { fileId, status: "processing", stage: "reading" });
      await jobs.enqueue(tx, d.jobs.recognize, { receiptId: row.id });
      await changed(tx, row.id);
      return { id: row.id };
    });
  }

  /** Этап для карточки (RCPT-02, RCPT-06): «Читаю…», «Проверяю арифметику…», «Перепроверка строки 2…». */
  async function setStage(
    s: ScopedDb,
    id: string,
    stage: ReceiptStage,
    disputedLines: readonly number[] = [],
  ): Promise<void> {
    await s.transaction(async (tx) => {
      await updateReceipt(tx, id, {
        stage,
        disputedLines: [...disputedLines],
        updatedAt: clock.now(),
      });
      await changed(tx, id);
    });
  }

  /** Чек — дубль: он не создаётся, а помечается «не вышло» со ссылкой на прежний (RCPT-04). */
  async function markDuplicate(s: ScopedDb, id: string, original: ReceiptRow): Promise<void> {
    await s.transaction(async (tx) => {
      await updateReceipt(tx, id, {
        status: "failed",
        stage: null,
        errorCode: "RECEIPT_DUPLICATE",
        duplicateOf: original.id,
        updatedAt: clock.now(),
      });
      await changed(tx, id);
    });
    log.info({ receiptId: id }, "receipt.duplicate");
  }

  async function markFailed(s: ScopedDb, id: string, code: string): Promise<void> {
    await s.transaction(async (tx) => {
      await updateReceipt(tx, id, {
        status: "failed",
        stage: null,
        errorCode: code,
        // Занятый УИ освобождается: тот же чек можно загрузить заново, он не станет «дублем» неудачи.
        uid: null,
        updatedAt: clock.now(),
      });
      await changed(tx, id);
    });
  }

  /** Занять УИ за этим чеком; гонка двух одинаковых загрузок — уникальный индекс, проигравший становится дублем. */
  async function claimUid(s: ScopedDb, id: string, uid: string): Promise<ReceiptRow | undefined> {
    try {
      await s.transaction((tx) => updateReceipt(tx, id, { uid, updatedAt: clock.now() }));
      return undefined;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const original = await findByUid(s, uid, id);
      if (original === undefined) throw error;
      return original;
    }
  }

  async function readFile(s: ScopedDb, row: ReceiptRow) {
    const file = await d.files.open(s, row.fileId as FileId);
    const type = PHOTO_TYPES[file.mime];
    if (type === undefined) throw new AppError("RECEIPT_UNREADABLE");
    return { type, bytes: new Uint8Array(await file.blob.arrayBuffer()) };
  }

  function toPrinted(extraction: ReceiptExtraction): PrintedReceipt {
    return {
      items: extraction.items,
      receiptDiscount: extraction.receiptDiscount,
      total: extraction.total,
    };
  }

  /** Строки для сохранения: числа разобраны, нормализованное наименование (RCPT-15), спорные пометки. */
  function itemsOf(
    read: ReadReceipt,
    disputed: ReadonlySet<number>,
    planned: readonly PlannedItem[],
  ): NewItem[] {
    return read.items.map((item, index) => ({
      categoryCode: planned[index]?.category.code ?? null,
      categoryId: planned[index]?.category.id ?? null,
      warranty: planned[index]?.warranty ?? false,
      position: index + 1,
      name: item.name,
      normalizedName: d.merchants.normalizeItemName(item.name),
      unit: item.unit,
      quantityMilli: item.quantityMilli,
      unitPriceMinor: item.unitPrice?.minor ?? null,
      discountMinor: item.discount.minor,
      lineTotalMinor: item.lineTotal?.minor ?? null,
      disputed: disputed.has(index + 1),
    }));
  }

  /** Задача receipts.recognize (worker): ошибка чтения — статус «не вышло», а не падение задачи (повтор не поможет). */
  async function run(s: ScopedDb, receiptId: string): Promise<void> {
    const row = await findReceipt(s, receiptId);
    if (row === undefined || row.status !== "processing") return;
    const started = performance.now();
    try {
      await progress(s, receiptId, 10);
      const photo = await readFile(s, row);
      const prepared = await d.preparer
        .prepare({ ...photo, maxSide: await settings.get(RECEIPTS_IMAGE_MAX_SIDE) })
        .catch((error: unknown) => {
          if (!(error instanceof PhotoReadError)) throw error;
          log.warn({ receiptId, reason: error.reason }, "receipt.photo-unreadable");
          throw new AppError("RECEIPT_UNREADABLE");
        });
      // RCPT-04: УИ из QR, локально и без модели; дубль ловится до дорогого чтения моделью.
      const uid = prepared.codes
        .map((code) => uidFromQr(code))
        .find((value) => value !== undefined);
      if (uid !== undefined) {
        const original =
          (await findByUid(s, uid, receiptId)) ?? (await claimUid(s, receiptId, uid));
        if (original !== undefined) return await markDuplicate(s, receiptId, original);
      }
      await progress(s, receiptId, 30);

      const extraction = await d.llm.extract(s.scope, {
        task: "receipt.extract",
        schema: ReceiptExtraction,
        instructions: RECEIPT_INSTRUCTIONS,
        document: RECEIPT_DOCUMENT,
        images: [{ data: prepared.image, mediaType: prepared.mime }],
        promptVersion: PROMPT_VERSION,
      });
      await progress(s, receiptId, 60);
      const currency = extraction.currency ?? DEFAULT_CURRENCY;
      const toleranceMinor = await settings.get(RECEIPTS_TOLERANCE_MINOR);
      const maxRechecks = await settings.get(RECEIPTS_MAX_RECHECKS);

      // RCPT-05: числа и арифметика — код. RCPT-06: перепроверка только спорных мест, не больше maxRechecks раз.
      let printed = toPrinted(extraction);
      const check = (value: PrintedReceipt) =>
        readReceipt(value, readItems(value, currency), { currency, toleranceMinor });
      let read = check(printed);
      const attempts: Attempt[] = [
        { attempt: 0, askedLines: [], changedLines: [], ok: read.ok, mismatches: read.mismatches },
      ];
      await setStage(s, receiptId, "checking");
      for (let attempt = 1; !read.ok && attempt <= maxRechecks; attempt++) {
        const asked = askedOf(read.mismatches);
        await setStage(s, receiptId, "rechecking", asked.lines);
        // Чек уже прочитан и сохранится в любом случае (P5, RCPT-07): сбой модели на перепроверке не отнимает его
        // у человека — он остаётся «требует проверки» с тем, что прочитано.
        const answer = await d.llm
          .extract(s.scope, {
            task: "receipt.extract",
            schema: ReceiptRecheck,
            instructions: recheckInstructions(describeMismatches(read)),
            document: RECEIPT_DOCUMENT,
            images: [{ data: prepared.image, mediaType: prepared.mime }],
            promptVersion: RECHECK_PROMPT_VERSION,
          })
          .catch((error: unknown) => {
            log.warn(
              { receiptId, attempt, code: error instanceof AppError ? error.code : "INTERNAL" },
              "receipt.recheck-failed",
            );
            return undefined;
          });
        if (answer === undefined) break;
        const merged = applyRecheck(printed, answer, asked);
        printed = merged.printed;
        read = check(printed);
        attempts.push({
          attempt,
          askedLines: asked.lines,
          changedLines: merged.changedLines,
          ok: read.ok,
          mismatches: read.mismatches,
        });
      }

      // Магазин и дубль без QR (RCPT-04): магазин + день + время + итог.
      const store = extraction.store?.trim() ?? "";
      const merchant = store === "" ? undefined : (await d.merchants.resolve([store]))[0];
      const date = extraction.date === null ? undefined : parsePrintedDate(extraction.date);
      const time = extraction.time === null ? undefined : parsePrintedTime(extraction.time);
      const printedTotal = parsePrintedMoney(printed.total, currency);
      if (uid === undefined && merchant !== undefined && merchant.key !== "") {
        if (date !== undefined && time !== undefined && printedTotal !== undefined) {
          const original = await findByKey(
            s,
            { storeKey: merchant.key, date, time, totalMinor: printedTotal.minor },
            receiptId,
          );
          if (original !== undefined) return await markDuplicate(s, receiptId, original);
        }
      }

      const disputedLines = read.mismatches.flatMap((mismatch) =>
        mismatch.kind === "line" ? [mismatch.line] : [],
      );
      const status = read.ok ? "ok" : "needs-review";
      // RCPT-09, RCPT-10: категории позиций (модель — вне транзакции), разбивка и операция чека.
      const planned = await plan(s, {
        read,
        currency,
        merchant: {
          name: store === "" ? null : (merchant?.name ?? store),
          key: merchant?.key || null,
        },
        date: date ?? clock.today().toString(),
        time: time ?? null,
        method: extraction.payment,
        cardLast4: extraction.payment === "card" ? extraction.cardLast4 : null,
      });
      // RCPT-07: расхождение итога с суммой строк — «нераспознанный остаток чека» (в «Прочее»); итог, разобранный из
      // текста, — напечатанный; не разобрался — по сумме строк.
      const remainderMinor =
        printedTotal !== undefined && !read.validation.total.ok
          ? read.validation.total.difference.value.minor
          : 0;
      await s.transaction(async (tx) => {
        // Повторный запуск после сбоя: чек уже сохранён — второй раз не пишем.
        const current = await lockReceipt(tx, receiptId);
        if (current === undefined || current.status !== "processing") return;
        const traceId = await d.explain.save(tx, read.validation.total.difference);
        await updateReceipt(tx, receiptId, {
          status,
          stage: null,
          storeName: store === "" ? null : store,
          storeKey: merchant?.key === "" ? null : (merchant?.key ?? null),
          merchantId: merchant?.merchantId ?? null,
          unp: extraction.unp,
          address: extraction.address,
          purchaseDate: date ?? null,
          purchaseTime: time ?? null,
          currency,
          totalMinor: read.total.minor,
          receiptDiscountMinor: read.receiptDiscount.minor,
          paymentMethod: extraction.payment,
          cardLast4: extraction.payment === "card" ? extraction.cardLast4 : null,
          disputedLines,
          mismatches: [...read.mismatches],
          remainderMinor,
          rechecks: attempts.length - 1,
          traceId,
          promptVersion: PROMPT_VERSION,
          errorCode: null,
          recognizedAt: clock.now(),
          updatedAt: clock.now(),
        });
        await replaceItems(tx, receiptId, itemsOf(read, new Set(disputedLines), planned.items));
        if (planned.operation !== undefined) {
          await d.transactions.recordFromReceipt(tx, {
            ...planned.operation,
            receiptId,
            needsReview: status === "needs-review",
          });
        }
        for (const attempt of attempts) {
          await insertAttempt(tx, receiptId, {
            attempt: attempt.attempt,
            askedLines: [...attempt.askedLines],
            changedLines: [...attempt.changedLines],
            ok: attempt.ok,
            mismatches: [...attempt.mismatches],
          });
        }
        await events.publish(tx, receiptsRecognized, { ids: [receiptId] });
        if (status === "needs-review") {
          await events.publish(tx, receiptsNeedsReview, { ids: [receiptId] });
          // NOTIF-02: «чек требует проверки» — одно уведомление на чек (ключ — id чека).
          await d.notifications.notify(tx, {
            kind: "receipt-review",
            key: receiptId,
            objectRef: { entity: ENTITY, id: receiptId },
            params: {},
          });
        }
        // RCPT-13: техника в чеке — календарь создаёт «конец гарантии» (CAL-04).
        if (planned.warrantyCount > 0) {
          await events.publish(tx, receiptsWarrantyItemsFound, { ids: [receiptId] });
        }
        await changed(tx, receiptId);
      });
      await progress(s, receiptId, 100);
      log.info(
        {
          receiptId,
          status,
          attempt: attempts.length - 1,
          count: read.items.length,
          ms: Math.round(performance.now() - started),
        },
        "receipt.recognized",
      );
    } catch (error) {
      const code = error instanceof AppError ? error.code : "INTERNAL";
      if (!(error instanceof AppError))
        log.error({ err: error, receiptId }, "receipt.recognize-failed");
      await markFailed(s, receiptId, code);
    }
  }

  return { start, run };
}

export type Recognize = ReturnType<typeof makeRecognize>;
