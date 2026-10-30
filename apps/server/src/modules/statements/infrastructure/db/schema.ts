// Таблицы statements (STMT-05, ARCHITECTURE §6.1, §16.1) — userOwnedTable. statement_formats: запомненный формат
// выписки — «отпечаток» (банк, набор и порядок колонок, вид файла) и схема разбора: роли колонок, порядок дат,
// десятичные разделители. Следующая выписка с тем же отпечатком разбирается без модели. Содержимого выписок здесь нет:
// только названия колонок в виде хэша и номера колонок.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { userOwnedTable } from "../../../../platform/db/tables.ts";
import type { ColumnSchema, SourceKind } from "../../domain/types.ts";

export const statementFormats = userOwnedTable(
  "statement_formats",
  {
    /** sha256 подписи формата (вид файла + нормализованные заголовки колонок), hex. */
    fingerprint: text().notNull(),
    sourceKind: text().$type<SourceKind>().notNull(),
    /** Банк как в шапке выписки — для показа; нет в выписке — null. */
    bank: text(),
    /** Нормализованное название банка: по нему замечаем, что формат того же банка изменился. */
    bankKey: text(),
    schema: jsonb().$type<ColumnSchema>().notNull(),
    /** Сколько выписок разобрано по этому формату. */
    usedCount: integer().notNull().default(1),
    lastUsedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    check("statement_formats_fingerprint_check", sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
    check("statement_formats_kind_check", sql`${t.sourceKind} in ('csv', 'xlsx', 'xls', 'pdf')`),
    check("statement_formats_used_check", sql`${t.usedCount} >= 1`),
    uniqueIndex("statement_formats_fingerprint_idx").on(t.householdId, t.fingerprint),
    index("statement_formats_bank_idx").on(t.householdId, t.bankKey),
  ],
);

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

export const statementImports = userOwnedTable(
  "statement_imports",
  {
    fileId: uuid().notNull(),
    status: text().$type<ImportStatus>().notNull(),
    method: text(),
    sourceKind: text(),
    bank: text(),
    mask: text(),
    currency: text(),
    periodFrom: date({ mode: "string" }),
    periodTo: date({ mode: "string" }),
    /** Итоги STMT-04: найдено, новых, дублей, спорных, пропущенных (ошибок). */
    found: integer().notNull().default(0),
    newCount: integer().notNull().default(0),
    duplicates: integer().notNull().default(0),
    doubtful: integer().notNull().default(0),
    skipped: integer().notNull().default(0),
    balanceStatus: text(),
    balanceDifferenceMinor: bigint({ mode: "number" }),
    formatChanged: boolean().notNull().default(false),
    warnings: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    payload: jsonb().$type<ImportPayload>(),
    /** Схема, заданная человеком в «Исправить колонки»: следующий разбор идёт по ней, без модели. */
    schemaOverride: jsonb().$type<ColumnSchema>(),
    errorCode: text(),
    accountId: uuid(),
    /** Откат (STMT-11): токен «Отменить» в журнале, поправка остатка и день с источником до импорта. */
    undoToken: text(),
    balanceAdjustment: jsonb().$type<{
      readonly adjustmentMinor: number;
      readonly balanceOn: string;
      readonly balanceSource: string;
    }>(),
    importedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      "statement_imports_status_check",
      sql`${t.status} in ('parsing', 'ready', 'importing', 'imported', 'rolled-back', 'failed')`,
    ),
    index("statement_imports_status_idx").on(t.householdId, t.status, t.createdAt),
  ],
);
