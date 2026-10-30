// Инструмент агента fin (AGT-03 «планирование», ADR-0009): свободный остаток одним числом и разбивкой — чтение. Описание —
// по-английски и коротко, вход пустой (данные — только ctx.s), выход — готовые числа с traceId (агент их не считает).
import { FreeBalance } from "@kosht/contract";
import { z } from "zod";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { FreeBalanceScenario } from "../application/free-balance.ts";

export function finTools(freeBalance: FreeBalanceScenario) {
  return {
    freeBalance: defineTool({
      name: "get_free_balance",
      toolset: "planning",
      kind: "read",
      description:
        "Monthly free balance in BYN: average regular income minus average mandatory payments, with the breakdown and number of months it covers. Null when there is not enough history.",
      input: z.object({}),
      output: FreeBalance,
      execute: (ctx) => freeBalance.view(ctx.s),
    }),
  };
}
