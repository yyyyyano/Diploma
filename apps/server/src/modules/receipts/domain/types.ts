// Типы разбора чека (RCPT-03, RCPT-05, RCPT-06). «Напечатанное» — то, что модель переписала с фото строками;
// «прочитанное» — то, что из этого разобрал код. Число, которое не разобралось, — null, а строка помечена.
import type { Money } from "@kosht/kernel";

/** Строка чека, как напечатана: все числа — текстом. */
export interface PrintedItem {
  readonly name: string;
  readonly quantity: string;
  readonly unit: string | null;
  readonly unitPrice: string;
  readonly discount: string | null;
  readonly lineTotal: string;
}

/** Чек, как напечатан: итог и скидки — текстом. */
export interface PrintedReceipt {
  readonly items: readonly PrintedItem[];
  readonly receiptDiscount: string | null;
  readonly total: string;
}

/** Строка после разбора чисел. */
export interface ReadItem {
  readonly name: string;
  readonly unit: string | null;
  readonly quantityMilli: number | null;
  readonly unitPrice: Money | null;
  readonly discount: Money;
  readonly lineTotal: Money | null;
}

/** Расхождение: арифметика строки, нечитаемое число в строке, арифметика итога, нечитаемый итог. */
export type Mismatch =
  | {
      readonly kind: "line";
      readonly line: number;
      readonly reason: "arithmetic";
      readonly expectedMinor: number;
      readonly printedMinor: number;
    }
  | { readonly kind: "line"; readonly line: number; readonly reason: "unreadable" }
  | {
      readonly kind: "total";
      readonly reason: "arithmetic";
      readonly expectedMinor: number;
      readonly printedMinor: number;
    }
  | { readonly kind: "total"; readonly reason: "unreadable" };

/** Состояние чека: «распознаётся» → «сходится» или «требует проверки»; «не вышло» — ошибка чтения или дубль (RCPT-04, RCPT-07). */
export type ReceiptStatus = "processing" | "ok" | "needs-review" | "failed";

/** Этап распознавания для карточки (RCPT-02): «Читаю чек…» → «Проверяю арифметику…» → «Перепроверка строки 2…». */
export type ReceiptStage = "reading" | "checking" | "rechecking";

/** Расхождение для хранения: без наименований и текста с чека (OBS-04) — только вид, номер строки и копейки. */
export type StoredMismatch = Mismatch;

export type PaymentMethod = "cash" | "card";
