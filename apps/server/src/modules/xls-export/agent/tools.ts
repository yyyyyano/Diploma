// Инструмент агента модуля xls-export (AGT-03 «отчёты», XLS-01): «выгрузи сентябрь в Excel» → ссылка на скачивание. Только чтение:
// файл собирается при открытии ссылки (а не здесь) и нигде не хранится; вход без владельца — данные только из `ctx.s`.
import { LocalDate, XlsExportLink } from "@kosht/contract";
import { z } from "zod";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { Export } from "../application/export.ts";

export function xlsExportTools(exporter: Export) {
  return {
    exportExcel: defineTool({
      name: "export_excel",
      toolset: "reports",
      kind: "read",
      description:
        "Excel file with the user's operations, summary by category and month, and limits for a period (default: current month). Returns a download link.",
      input: z.object({ from: LocalDate.schema.optional(), to: LocalDate.schema.optional() }),
      output: XlsExportLink,
      execute: (ctx, input) => exporter.link(ctx.s, input),
    }),
  };
}
