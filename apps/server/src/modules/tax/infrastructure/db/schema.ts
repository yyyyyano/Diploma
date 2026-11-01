// Таблицы модуля tax (ARCHITECTURE §6.1, TAX-20) — userOwnedTable. «Найденный вычет» — одна запись на основание: операция
// (`tx:<id>` — оплата обучения) или факт профиля (`facts:children`, `facts:housing`); уникальный индекс + ON CONFLICT DO NOTHING:
// повтор события дубль не создаёт, «Не моё» не возвращается само. Деньги — целые копейки, сумма «до» — из калькулятора T-045 с traceId.
import { sql } from "drizzle-orm";
import { bigint, check, date, integer, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { userOwnedTable } from "../../../../platform/db/tables.ts";

export const FOUND_KINDS = ["education", "housing", "children"] as const;
export const FOUND_STATUSES = ["new", "shown", "dismissed", "filed"] as const;
export const FOUND_REASONS = ["ask-queue", "check"] as const;

export const foundDeductions = userOwnedTable(
  "found_deductions",
  {
    kind: text().notNull(),
    /** Основание: `tx:<id операции>`, `facts:children`, `facts:housing`. */
    basisKey: text().notNull(),
    /** Операция-основание (без FK: чужой модуль, удалённая операция видна в чтении как «операции нет»). */
    operationId: uuid(),
    /** Налоговый год основания. */
    year: integer().notNull(),
    status: text().notNull().default("new"),
    /** Жильё: `ask-queue` — нужен один вопрос об учёте нуждающихся, `check` — учёт есть, проверьте условия; у прочих — null. */
    reason: text(),
    /** Сумма «до» из калькулятора (копейки BYN) и её расчёт; у жилья без расчёта — null. */
    amountMinor: bigint({ mode: "number" }),
    traceId: uuid(),
    /** Снимок основания для показа: день и сумма в BYN операции («оплата 12.09, 2 000,00»); у основания-факта — null. */
    basisOn: date({ mode: "string" }),
    basisMinor: bigint({ mode: "number" }),
    /** Получатель платежа — подпись основания («БГУ»); у основания-факта — null. */
    payee: text(),
    foundOn: date({ mode: "string" }).notNull(),
  },
  (t) => [
    check("found_deductions_kind_check", sql`${t.kind} in ('education', 'housing', 'children')`),
    check(
      "found_deductions_status_check",
      sql`${t.status} in ('new', 'shown', 'dismissed', 'filed')`,
    ),
    check(
      "found_deductions_reason_check",
      sql`${t.reason} is null or ${t.reason} in ('ask-queue', 'check')`,
    ),
    check("found_deductions_amount_check", sql`${t.amountMinor} is null or ${t.amountMinor} >= 0`),
    uniqueIndex("found_deductions_basis_idx").on(t.householdId, t.userId, t.kind, t.basisKey),
  ],
);
