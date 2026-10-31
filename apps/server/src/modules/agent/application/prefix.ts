// Префикс агента (ARCHITECTURE §8.2, CONSTRAINTS «Префикс агента ≤ 3 000 токенов»): системная подсказка и описания
// инструментов набора — то, что уходит провайдеру в начале каждого запроса и кэшируется им. Здесь — тот же текст для
// подсчёта токенов в тесте (o200k_base): инструменты реестра набора и собственные инструменты агента (`ask_user`,
// `make_chart`).
import type { Toolset, ToolDef } from "../../../platform/tools/define-tool.ts";
import { systemPrompt } from "../prompts/system.prompt.ts";
import { ASK_USER, ASK_USER_DESCRIPTION, AskInput } from "./ask-user.ts";
import { MAKE_CHART, MAKE_CHART_DESCRIPTION } from "./make-chart.ts";
import { ChartData } from "@kosht/contract";
import { providerJsonSchema } from "./tool-schema.ts";
import { inToolset } from "./toolsets.ts";

export function agentPrefix(tools: readonly ToolDef[], toolset: Toolset = "core"): string {
  const definitions = [
    ...tools
      .filter((t) => inToolset(t.toolset, toolset))
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: providerJsonSchema(t.input),
      })),
    {
      name: ASK_USER,
      description: ASK_USER_DESCRIPTION,
      inputSchema: providerJsonSchema(AskInput),
    },
    {
      name: MAKE_CHART,
      description: MAKE_CHART_DESCRIPTION,
      inputSchema: providerJsonSchema(ChartData),
    },
  ];
  return `${systemPrompt(toolset)}\n${JSON.stringify(definitions)}`;
}
