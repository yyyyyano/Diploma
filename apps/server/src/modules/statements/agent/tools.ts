// Инструменты агента модуля statements (AGT-03 «документы», ADR-0009): статус импорта выписки — «разбирается ли файл,
// что нашли, сколько новых». Только чтение; вход без владельца (данные — ctx.s), числа — как посчитал код (P1, P2).
import { ImportSummary, StatementImportId } from "@kosht/contract";
import { z } from "zod";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { Imports } from "../application/imports.ts";
import { toSummary } from "../application/mapping.ts";

export function statementsTools(imports: Imports) {
  return {
    status: defineTool({
      name: "statement_import_status",
      toolset: "reports",
      kind: "read",
      description:
        "Status of a bank statement import by id: parsing, ready (found, new, duplicate counts), imported or failed.",
      input: z.object({ id: StatementImportId }),
      output: ImportSummary,
      execute: async (ctx, input) => toSummary(await imports.get(ctx.s, input.id)),
    }),
  };
}
