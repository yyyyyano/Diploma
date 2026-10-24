import { makeScope } from "@kosht/kernel";

// ToolDef.execute(ctx, input) — вызов инструмента агента, а не SQL (ARCHITECTURE §8.2); ctx.s — из scope запуска.
export async function runTool(def: ToolDef<unknown, unknown>, run: AgentRun, input: unknown) {
  return def.execute({ ...run.ctx, scope: makeScope(run.scope) }, input);
}
