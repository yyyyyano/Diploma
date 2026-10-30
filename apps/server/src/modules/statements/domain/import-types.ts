// Типы импорта выписки (STMT-04, STMT-11): статус, строка предпросмотра и тело черновика. Живут в domain: их читают и
// сценарии, и таблица statement_imports (jsonb), а схему таблицы сценариям видеть нельзя.
import type { ColumnSchema } from "./types.ts";

/** Статусы импорта (STMT-04, STMT-11): разбор → предпросмотр → импорт → откат; брошенный черновик удаляет обход. */
export const IMPORT_STATUSES = [
  "parsing",
  "ready",
  "importing",
  "imported",
  "rolled-back",
  "failed",
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** Строка предпросмотра: что будет записано. Всё посчитано до импорта (модель, курсы, дубли) — импорт только пишет. */
export interface PreviewRow {
  readonly index: number;
  readonly date: string;
  readonly time?: string;
  /** Сумма со знаком счёта, копейки валюты счёта. */
  readonly minor: number;
  readonly currency: string;
  /** Исходное описание из файла (STMT-06 хранит его всегда). */
  readonly description: string;
  readonly merchantName: string | null;
  readonly merchantKey: string | null;
  readonly kind: "expense" | "income" | "refund" | "transfer";
  readonly direction: "in" | "out";
  readonly category: {
    readonly code?: string;
    readonly id?: string;
    readonly source: string;
  } | null;
  readonly duplicate: boolean;
  /** Спорный перевод: «себе или другому человеку?» — пакет «Да/Нет» после импорта. */
  readonly doubtful: boolean;
  readonly amountBynMinor: number | null;
  readonly fxRateId: string | null;
  readonly dedupeKey: string;
  readonly externalId?: string;
  readonly pairWithId?: string;
  readonly cashCounterpart?: boolean;
  readonly refundOfId?: string;
  readonly refundOfIndex?: number;
  /** Строка не записывается: валюта не равна валюте счёта (ошибка разбора). */
  readonly skipped?: boolean;
}

/** Тело черновика: строки и схема (запоминается при импорте). */
export interface ImportPayload {
  readonly rows: readonly PreviewRow[];
  readonly schema: ColumnSchema | null;
  readonly fingerprint: string | null;
  /** Остаток на конец периода из выписки и день, на который он известен (STMT-02). */
  readonly closing: { readonly minor: number; readonly on: string } | null;
  readonly sample: {
    readonly header: readonly string[];
    readonly rows: readonly (readonly string[])[];
  } | null;
}
