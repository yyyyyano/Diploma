// Префикс агента (ARCHITECTURE §8.2, CONSTRAINTS «Префикс агента ≤ 3 000 токенов»): системная подсказка и описания
// инструментов набора — то, что уходит провайдеру в начале каждого запроса и кэшируется им. Здесь — тот же текст для
// подсчёта токенов в тесте (o200k_base).
import { z } from "zod";
import type { ToolDef } from "../../../platform/tools/define-tool.ts";
import { SYSTEM_PROMPT } from "../prompts/system.prompt.ts";
import { DEFAULT_TOOLSET } from "./run-agent.ts";

export function agentPrefix(tools: readonly ToolDef[]): string {
  const definitions = tools
    .filter((t) => t.toolset === DEFAULT_TOOLSET)
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.input),
    }));
  return `${SYSTEM_PROMPT}\n${JSON.stringify(definitions)}`;
}
