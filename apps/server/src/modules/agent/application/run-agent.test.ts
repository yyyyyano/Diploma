// AGT-01, AGT-13, ARCHITECTURE §8.2: цикл агента на MockLanguageModelV4 — инструмент из реестра с ctx.s из scope
// запуска, ошибка инструмента — { ok: false, code }, не больше MAX_STEPS шагов и на последнем — toolChoice "none".
import type { Scope } from "@kosht/kernel";
import {
  MockLanguageModelV4,
  testScope,
  type LanguageModelV4CallOptions,
  type LanguageModelV4StreamPart,
} from "@kosht/testing";
import { simulateReadableStream, type UIMessage, type UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { createTelemetry } from "../../../platform/telemetry/telemetry.ts";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import type { LlmFacade } from "../../llm/index.ts";
import { makeRunAgent } from "./run-agent.ts";

const scope = testScope();
const s = { scope } as ScopedDb;

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function toolCall(toolName: string): LanguageModelV4StreamPart[] {
  return [
    { type: "tool-call", toolCallId: `call-${toolName}`, toolName, input: "{}" },
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
  ];
}

function text(value: string): LanguageModelV4StreamPart[] {
  return [
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: value },
    { type: "text-end", id: "t" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
  ];
}

/** Модель: зовёт инструмент toolName, пока разрешено и пока не превышено calls; иначе — текст. */
function model(toolName: string, toolTurns: number) {
  const calls: LanguageModelV4CallOptions[] = [];
  const mock = new MockLanguageModelV4({
    doStream: async (options) => {
      calls.push(options);
      const useTool = options.toolChoice?.type !== "none" && calls.length <= toolTurns;
      return {
        stream: simulateReadableStream({ chunks: useTool ? toolCall(toolName) : text("Готово.") }),
      };
    },
  });
  return { mock, calls };
}

function llm(mock: MockLanguageModelV4): LlmFacade {
  const telemetry = createTelemetry(false);
  return {
    model: async (caller, functionId, call) => ({
      model: mock,
      telemetry: telemetry.options({
        functionId,
        userId: (caller as Scope).userId,
        ...(call?.sessionId === undefined ? {} : { sessionId: call.sessionId }),
      }),
    }),
    extract: () => Promise.reject(new Error("не нужен")),
    classify: () => Promise.reject(new Error("не нужен")),
    embed: () => Promise.reject(new Error("не нужен")),
    transcribe: () => Promise.reject(new Error("не нужен")),
  };
}

const household = defineTool({
  name: "household_of_run",
  toolset: "core",
  kind: "read",
  description: "Return the household of the run.",
  input: z.object({}),
  output: z.object({ household: z.string() }),
  execute: async (ctx) => ({ household: ctx.s.scope.householdId }),
});

const broken = defineTool({
  name: "broken",
  toolset: "core",
  kind: "read",
  description: "Always not found.",
  input: z.object({}),
  output: z.object({}),
  execute: async () => {
    throw new AppError("NOT_FOUND");
  },
});

const question: UIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "Какие у меня счета?" }],
};

async function run(toolName: string, toolTurns: number, maxSteps = 8) {
  const { mock, calls } = model(toolName, toolTurns);
  let finished: { message: UIMessage; aborted: boolean } | undefined;
  const stream = await makeRunAgent({
    llm: llm(mock),
    tools: () => [household, broken],
    scoped: (given) => ({ scope: given }) as ScopedDb,
    log: memoryLogger().log,
    maxSteps: async () => maxSteps,
  })(s, {
    messages: [question],
    abortSignal: new AbortController().signal,
    requestId: "req-1",
    sessionId: "dialog-1",
    messageId: "m-1",
    metadata: { runId: "run-1" },
    onFinish: async (message, aborted) => {
      finished = { message, aborted };
    },
  });
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { chunks, calls, finished };
}

describe("AGT-01: цикл агента", () => {
  it("инструмент из реестра видит домохозяйство запуска; ответ — поток с метаданными runId", async () => {
    const { chunks, finished } = await run("household_of_run", 1);
    expect(chunks[0]).toMatchObject({
      type: "start",
      messageId: "m-1",
      messageMetadata: { runId: "run-1" },
    });
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-output-available",
        output: { household: scope.householdId },
      }),
    );
    expect(finished?.aborted).toBe(false);
    expect(finished?.message.parts).toContainEqual(
      expect.objectContaining({ type: "text", text: "Готово." }),
    );
  });

  it("AGT-13: ошибка инструмента — { ok: false, code } в результате шага, агент продолжает", async () => {
    const { chunks } = await run("broken", 1);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-output-available",
        output: { ok: false, code: "NOT_FOUND" },
      }),
    );
  });

  it("не больше MAX_STEPS шагов; на последнем — toolChoice none, ответ — текст", async () => {
    const { calls, finished } = await run("household_of_run", 100, 3);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.toolChoice?.type)).toEqual(["auto", "auto", "none"]);
    expect(finished?.message.parts.at(-1)).toMatchObject({ type: "text", text: "Готово." });
  });
});
