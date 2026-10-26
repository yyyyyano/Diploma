// Таблица explanations (EXPL-02, P2) — userOwnedTable: сохранённая трасса расчёта рядом с результатом. Строка не
// меняется: объяснение показывает именно тот расчёт, которым получено число, даже если исходные данные потом изменились.
import { date, jsonb } from "drizzle-orm/pg-core";
import type { TraceNode } from "@kosht/kernel";
import { userOwnedTable } from "../../../../platform/db/tables.ts";

export const explanations = userOwnedTable("explanations", {
  trace: jsonb().$type<TraceNode>().notNull(),
  /** Период расчёта (обе границы входят); нет — расчёт не о периоде. */
  periodFrom: date(),
  periodTo: date(),
});
