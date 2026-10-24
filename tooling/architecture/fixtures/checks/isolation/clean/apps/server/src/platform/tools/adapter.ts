// ToolDef.execute(ctx, input) — вызов инструмента агента, а не SQL (ARCHITECTURE §8.2).
export async function runTool(def: ToolDef<unknown, unknown>, ctx: ToolCtx, input: unknown) {
  return def.execute(ctx, input);
}
