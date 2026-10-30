// Таблица explanations (EXPL-02, P2) — userOwnedTable: сохранённая трасса расчёта рядом с результатом. Строка не
// меняется: объяснение показывает именно тот расчёт, которым получено число, даже если исходные данные потом изменились.
import { date, jsonb, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { TraceNode } from "@kosht/kernel";
import { userOwnedTable } from "../../../../platform/db/tables.ts";

export const explanations = userOwnedTable(
  "explanations",
  {
    trace: jsonb().$type<TraceNode>().notNull(),
    /** Период расчёта (обе границы входят); нет — расчёт не о периоде. */
    periodFrom: date(),
    periodTo: date(),
    /**
     * sha256 канонического JSON трассы и периода: одинаковый расчёт — одна строка, таблица не растёт от повторных
     * открытий (EXPL-02). Старые строки — без хэша (null не конфликтует).
     */
    traceHash: text(),
  },
  (t) => [uniqueIndex("explanations_trace_hash_idx").on(t.householdId, t.traceHash)],
);
