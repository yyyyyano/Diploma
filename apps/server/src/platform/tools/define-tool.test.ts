// AGT-03, AGT-05, AGT-07, ARCHITECTURE §8.2: инструмент агента описывает модуль-владелец через defineTool — без AI
// SDK. read/write выполняются сразу (execute), destructive только предлагает ожидающее действие (propose): удалить
// «молча» нельзя по типу. Проверки типов — @ts-expect-error (CONSTRAINTS «Пол»: тест «не компилируется»).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineTool,
  TOOLSETS,
  type DestructiveTool,
  type ImmediateTool,
  type ToolCtx,
} from "./define-tool.ts";

const Period = z.object({ from: z.string(), to: z.string() });

describe("defineTool: read и write выполняются сразу", () => {
  it("возвращает описание с типизированным execute — вход проверен схемой модуля", async () => {
    const tool = defineTool({
      name: "search_transactions",
      toolset: "core",
      kind: "read",
      description: "Find user's transactions by period.",
      input: z.object({ period: Period }),
      output: z.object({ count: z.number() }),
      execute: async (_ctx, input) => ({ count: input.period.from.length }),
    });
    expect(tool).toMatchObject({ name: "search_transactions", toolset: "core", kind: "read" });
    const ctx = { requestId: "req-1", channel: "web" } as ToolCtx;
    expect(await tool.execute(ctx, { period: { from: "2026-09", to: "2026-09" } })).toEqual({
      count: 7,
    });
  });

  it("четыре фиксированных набора — core, legal, planning, reports (новый — только через ADR)", () => {
    expect(TOOLSETS).toEqual(["core", "legal", "planning", "reports"]);
  });
});

describe("AGT-07: destructive только предлагает действие", () => {
  it("propose возвращает id решения и число затронутых объектов", async () => {
    const tool = defineTool({
      name: "delete_account",
      toolset: "planning",
      kind: "destructive",
      description: "Propose deleting an account; the user confirms it.",
      input: z.object({ accountId: z.uuid() }),
      propose: async () => ({ decisionId: "decision-1", count: 1 }),
    });
    expect(tool.kind).toBe("destructive");
    const id = "0190f0a0-0000-7000-8000-000000000001";
    expect(await tool.propose({} as ToolCtx, { accountId: id })).toEqual({
      decisionId: "decision-1",
      count: 1,
    });
  });

  it("удалить нельзя по типу: у destructive нет execute, у read и write нет propose", () => {
    const destructive: DestructiveTool = {
      name: "delete_goal",
      toolset: "planning",
      kind: "destructive",
      description: "Delete a goal.",
      input: z.object({}),
      propose: async () => ({ decisionId: "decision-1", count: 1 }),
      // @ts-expect-error destructive не выполняет действие сам — только propose (AGT-07)
      execute: async () => ({}),
    };
    const read: ImmediateTool = {
      name: "list_goals",
      toolset: "planning",
      kind: "read",
      description: "List goals.",
      input: z.object({}),
      output: z.object({}),
      execute: async () => ({}),
      // @ts-expect-error read и write выполняются сразу: ожидающего действия у них нет
      propose: async () => ({ decisionId: "decision-1", count: 1 }),
    };
    // Описания, собранные в обход типов, отвергает и само определение.
    expect(() => defineTool(destructive)).toThrow(/destructive/);
    expect(() => defineTool(read)).toThrow(/propose/);
  });

  it("read без execute не компилируется и отвергается при определении", () => {
    // @ts-expect-error read выполняется сразу: execute обязателен
    const read: ImmediateTool = {
      name: "list_goals",
      toolset: "planning",
      kind: "read",
      description: "List goals.",
      input: z.object({}),
      output: z.object({}),
    };
    expect(() => defineTool(read)).toThrow(/execute/);
  });
});

describe("ARCHITECTURE §6.4: «чьи данные» — только ctx.s", () => {
  it.each(["userId", "householdId", "ownerId"])(
    "поле %s во входной схеме — ошибка при определении",
    (key) => {
      expect(() =>
        defineTool({
          name: "get_receipt",
          toolset: "core",
          kind: "read",
          description: "Receipt with items.",
          input: z.object({ [key]: z.string() }),
          output: z.object({}),
          execute: async () => ({}),
        }),
      ).toThrow(key);
    },
  );
});

describe("имя, набор и описание проверяются при определении", () => {
  const base = {
    toolset: "core",
    kind: "read",
    input: z.object({}),
    output: z.object({}),
    execute: async () => ({}),
  } as const;

  it("имя — snake_case латиницей", () => {
    expect(() => defineTool({ ...base, name: "getReceipt", description: "Receipt." })).toThrow(
      /snake_case/,
    );
  });

  it("описание — коротко по-английски: кириллица отвергается", () => {
    expect(() =>
      defineTool({ ...base, name: "get_receipt", description: "Чек с позициями" }),
    ).toThrow(/English/);
  });

  it("пустое описание отвергается", () => {
    expect(() => defineTool({ ...base, name: "get_receipt", description: "" })).toThrow(/English/);
  });

  it("набор вне четырёх — ошибка и по типу, и при определении", () => {
    const define = () =>
      defineTool({
        ...base,
        name: "get_receipt",
        description: "Receipt.",
        // @ts-expect-error набор инструментов только из TOOLSETS: новый — через ADR (кэш префикса)
        toolset: "misc",
      });
    expect(define).toThrow(/misc/);
  });
});
