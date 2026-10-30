// Инструменты агента модуля receipts (AGT-03 «документы», ADR-0009): чек по id и статус недавних чеков — «разобран ли
// чек, сходится ли сумма, какие строки спорные». Только чтение; вход без владельца (данные — ctx.s), числа — как посчитал код.
import { ReceiptCard, ReceiptId, ReceiptSummary } from "@kosht/contract";
import { z } from "zod";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { Review } from "../application/review.ts";

export function receiptsTools(review: Review) {
  return {
    get: defineTool({
      name: "get_receipt",
      toolset: "reports",
      kind: "read",
      description:
        "A receipt by id: store, date, total, items with categories, status (ok or needs-review), disputed lines and its operation.",
      input: z.object({ id: ReceiptId }),
      output: ReceiptCard,
      execute: (ctx, input) => review.get(ctx.s, input.id),
    }),
    status: defineTool({
      name: "receipt_status",
      toolset: "reports",
      kind: "read",
      description:
        "Recent receipts with recognition status: processing, ok (sum matches), needs-review (disputed lines) or failed (duplicate or unreadable).",
      input: z.object({}),
      output: z.object({ items: z.array(ReceiptSummary) }),
      execute: async (ctx) => ({ items: (await review.list(ctx.s)).slice(0, 10) }),
    }),
  };
}
