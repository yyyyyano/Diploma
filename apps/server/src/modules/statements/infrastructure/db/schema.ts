// Таблицы statements (STMT-05, ARCHITECTURE §6.1, §16.1) — userOwnedTable. statement_formats: запомненный формат
// выписки — «отпечаток» (банк, набор и порядок колонок, вид файла) и схема разбора: роли колонок, порядок дат,
// десятичные разделители. Следующая выписка с тем же отпечатком разбирается без модели. Содержимого выписок здесь нет:
// только названия колонок в виде хэша и номера колонок.
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
