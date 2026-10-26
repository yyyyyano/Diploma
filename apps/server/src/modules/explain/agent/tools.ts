// Инструмент агента explain (AGT-03 «объяснение», EXPL-01): расчёт числа по traceId из результата другого инструмента —
// сохранённая трасса, а не пересчёт (EXPL-02). Данные — только ctx.s.
import { Explanation } from "@kosht/contract";
import { TraceId } from "@kosht/kernel";
import { z } from "zod";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { Explanations } from "../application/explanations.ts";
import { toExplanationDto } from "../api/router.ts";

export function explainNumberTool(explanations: Pick<Explanations, "get">) {
  return defineTool({
    name: "explain_number",
    toolset: "core",
    kind: "read",
    description:
      "Explain how a number was calculated: returns the saved calculation tree for a traceId from another tool result.",
    input: z.object({ traceId: TraceId }),
    output: Explanation,
    execute: async (ctx, input) => toExplanationDto(await explanations.get(ctx.s, input.traceId)),
  });
}
