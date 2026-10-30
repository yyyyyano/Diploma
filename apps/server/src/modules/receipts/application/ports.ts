// Внешний мир модуля receipts: подготовка фото — недоверенный разбор картинки в изолированном потоке (SEC-03).
// В тестах порт подменяется офлайн-реализацией; боевой адаптер — infrastructure/image/prepare-photo.ts.
import type { Money } from "@kosht/kernel";
import type { PaymentMethod } from "../domain/types.ts";

/** Тип фото по содержимому (его определил модуль files). */
export type PhotoType = "jpg" | "png" | "webp" | "heic";

export interface PreparedPhoto {
  /** Копия для модели: JPEG без метаданных (EXIF и GPS не уходят дальше), длинная сторона ограничена. */
  readonly image: Uint8Array;
  readonly mime: "image/jpeg";
  /** Тексты всех QR-кодов, найденных на фото, по порядку попыток (RCPT-04). */
  readonly codes: readonly string[];
}

export interface PrepareInput {
  readonly type: PhotoType;
  readonly bytes: Uint8Array;
  /** Длинная сторона копии для модели, пиксели. */
  readonly maxSide: number;
}

/** Причина отказа подготовки (для лога, без содержимого). */
export type PrepareFailure = "timeout" | "memory" | "failed" | "unreadable";

export class PhotoReadError extends Error {
  override name = "PhotoReadError";
  readonly reason: PrepareFailure;
  constructor(reason: PrepareFailure) {
    super(`photo:${reason}`);
    this.reason = reason;
  }
}

export interface PhotoPreparer {
  /** Подготовить фото: HEIC → пиксели, поворот, копия для модели, QR; отказ — PhotoReadError. */
  prepare(input: PrepareInput): Promise<PreparedPhoto>;
}

/** Категория в строке БД: встроенная по коду или своя по id. */
export interface StoredCategoryRef {
  readonly code?: string;
  readonly id?: string;
}

/** Операция чека для модуля transactions (форма — `transactions/application/receipt-ops.ts`, фасад `recordFromReceipt`). */
export interface ReceiptOperation {
  readonly receiptId: string;
  readonly method: PaymentMethod | null;
  readonly cardLast4: string | null;
  readonly occurredOn: string;
  readonly occurredTime: string | null;
  readonly amount: Money;
  readonly merchantName: string | null;
  readonly merchantKey: string | null;
  readonly category: StoredCategoryRef & { readonly source: string };
  readonly splits: readonly { readonly category: StoredCategoryRef; readonly amount: Money }[];
  readonly needsReview: boolean;
}
