// ARCHITECTURE §6.4, AGT-13: адаптер инструментов — ctx.s из scope запуска, ошибки — { ok: false, code } без текста.
import { testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Scope } from "@kosht/kernel";
import type { ScopedDb } from "../db/scoped-db.ts";
import { AppError } from "../errors/app-error.ts";
import { memoryLogger } from "../logging/__fixtures__/memory-logger.ts";
import { bindTools } from "./bind-tools.ts";
import { defineTool } from "./define-tool.ts";

const scope = testScope();
/** ScopedDb для адаптера: инструментам теста нужен только scope. */
const scoped = (given: Scope) => ({ scope: given }) as ScopedDb;

const whoAmI = defineTool({
  name: "who_am_i",
  toolset: "core",
  kind: "read",
  description: "Return the household of the run.",
  input: z.object({ limit: z.int().max(5).default(1) }),
  output: z.object({ household: z.string(), limit: z.int() }),
  execute: async (ctx, input) => ({ household: ctx.s.scope.householdId, limit: input.limit }),
});

const failing = (error: unknown) =>
  defineTool({
    name: "failing",
    toolset: "core",
    kind: "read",
    description: "Always fails.",
    input: z.object({}),
    output: z.object({}),
    execute: async () => {
      throw error;
    },
  });

function bind(tool: Parameters<typeof bindTools>[0][number]) {
  const memory = memoryLogger();
  const [bound] = bindTools([tool], {
    scope,
    scoped,
    requestId: "req-1",
    channel: "web",
    log: memory.log,
  });
  if (bound === undefined) throw new Error("нет инструмента");
  return { bound, memory };
}

describe("ARCHITECTURE §6.4: ctx.s — из scope запуска агента", () => {
  it("инструмент видит домохозяйство запуска; аргументы — по схеме входа", async () => {
    expect(await bind(whoAmI).bound.execute({})).toEqual({
      household: scope.householdId,
      limit: 1,
    });
  });
});

describe("AGT-13: ошибка инструмента — { ok: false, code }", () => {
  it("аргументы модели не по схеме — VALIDATION", async () => {
    expect(await bind(whoAmI).bound.execute({ limit: 50 })).toEqual({
      ok: false,
      code: "VALIDATION",
    });
  });

  it("AppError инструмента — его код", async () => {
    expect(await bind(failing(new AppError("NOT_FOUND"))).bound.execute({})).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it("прочая ошибка — INTERNAL без текста для модели, стек — в лог", async () => {
    const { bound, memory } = bind(failing(new Error("секрет ivan@mail.by")));
    const result = await bound.execute({});
    expect(result).toEqual({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(result)).not.toContain("ivan");
    expect(memory.lines().map((line) => line["msg"])).toContain("agent.tool-failed");
  });

  it("destructive только предлагает ожидающее действие: { ok: true, pending: { decisionId, count } }", async () => {
    const remove = defineTool({
      name: "delete_account",
      toolset: "planning",
      kind: "destructive",
      description: "Propose deleting an account.",
      input: z.object({ id: z.uuid() }),
      propose: async () => ({ decisionId: "decision-1", count: 1 }),
    });
    const id = "0190f0a0-0000-7000-8000-0000000000aa";
    expect(await bind(remove).bound.execute({ id })).toEqual({
      ok: true,
      pending: { decisionId: "decision-1", count: 1 },
    });
  });
});
