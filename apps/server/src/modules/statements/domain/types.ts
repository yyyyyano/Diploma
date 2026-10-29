// Типы разбора выписки (STMT-04, STMT-05, ARCHITECTURE §16.1): сырая таблица из файла, смысл колонок и результат
// parseStatement — ParsedStatement. Чистые типы без файлов и сети: читает файл infrastructure/parsing (в песочнице),
// смысл колонок и правила значений — здесь.
import type { Money } from "@kosht/kernel";

/** Откуда прочитана таблица: от этого зависят позиции ячеек (PDF — по координатам) и отпечаток формата. */
export type SourceKind = "csv" | "xlsx" | "xls" | "pdf";

/** Ячейка: текст как в файле (числа Excel — каноническим десятичным видом) и, у PDF, горизонтальные границы. */
export interface RawCell {
  readonly text: string;
  readonly x0?: number;
  readonly x1?: number;
}

/** Строка таблицы; у PDF — ещё страница и вертикальная позиция (перенос длинного описания на вторую строку). */
export interface RawLine {
  readonly cells: readonly RawCell[];
  readonly page?: number;
  readonly y?: number;
}

export interface RawTable {
  readonly kind: SourceKind;
  readonly lines: readonly RawLine[];
}

/** Картинка страницы или фото: скан читает модель с изображениями (STMT-04 шаг 4). */
export interface RawImage {
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/** Что вернуло чтение файла: таблица (текстовый файл или PDF с текстовым слоем) или картинки (скан). */
export type RawDocument =
  | { readonly kind: "table"; readonly table: RawTable }
  | { readonly kind: "images"; readonly images: readonly RawImage[] };

/** Смысл колонки (STMT-04 шаг 2); `ignore` — колонка не нужна. */
export const ROLES = [
  "date",
  "time",
  "description",
  "amount",
  "debit",
  "credit",
  "currency",
  "operationAmount",
  "operationCurrency",
  "balance",
  "operationId",
  "ignore",
] as const;
export type Role = (typeof ROLES)[number];

/** Роли денежных колонок: у каждой свой десятичный разделитель (в файле бывают и «1 234,56», и «1234.56»). */
export const MONEY_ROLES: readonly Role[] = [
  "amount",
  "debit",
  "credit",
  "balance",
  "operationAmount",
];

export type DecimalSeparator = "," | ".";
/** Порядок числовой даты: «15.09.2026» — день первым, «09/15/2026» — месяц первым. */
export type DateOrder = "dmy" | "mdy";

export interface ColumnSpec {
  readonly index: number;
  readonly role: Role;
  /** Только у денежных колонок. */
  readonly decimal?: DecimalSeparator;
}

/** Схема разбора: что запоминается в `statement_formats` и применяется к следующей выписке того же формата. */
export interface ColumnSchema {
  readonly columns: readonly ColumnSpec[];
  readonly dateOrder: DateOrder;
}

/** Как найдены колонки (ARCHITECTURE §16.1): запомненный формат, эвристика по словарю заголовков или модель. */
export type ParseMethod = "remembered" | "detected" | "model";

export interface ParsedRow {
  /** ISO-дата операции. */
  readonly date: string;
  /** «чч:мм», если время есть в выписке. */
  readonly time?: string;
  readonly description: string;
  /** Сумма со стороны счёта: поступление +, списание − (в валюте счёта, либо валюты строки). */
  readonly amount: Money;
  /** Сумма в валюте операции, если она отличается от валюты счёта (STMT-09). */
  readonly original?: Money;
  readonly balance?: Money;
  readonly operationId?: string;
}

export type BalanceStatus = "ok" | "mismatch" | "unknown";

export interface ParsedStatement {
  readonly bank?: string;
  /** Последние 4 цифры карты или счёта. */
  readonly accountMask?: string;
  readonly currency: string;
  readonly period?: { readonly from: string; readonly to: string };
  readonly opening?: Money;
  readonly closing?: Money;
  readonly rows: readonly ParsedRow[];
  readonly method: ParseMethod;
  /** Отпечаток формата (STMT-05): ключ запомненной схемы; у скана его нет. */
  readonly fingerprint?: string;
  /** Схема, по которой разобрано: её запоминает rememberFormat после успешного импорта. */
  readonly schema?: ColumnSchema;
  readonly sourceKind: SourceKind | "scan";
  /** Формат банка изменился: запомненная схема того же банка не подошла (STMT-05). */
  readonly formatChanged: boolean;
  /** Сверка цепочки остатков (STMT-04 шаг 3): расхождение — «проверьте». */
  readonly balance: {
    readonly status: BalanceStatus;
    readonly difference?: Money;
    /** Трасса расхождения для «Откуда эта цифра?». */
    readonly trace?: unknown;
  };
  /** Предупреждения разбора кодами: `currency-assumed`, `rows-skipped` — сайт покажет по словарю. */
  readonly warnings: readonly string[];
}
