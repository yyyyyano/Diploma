// Запуск агента (AGT-01, ADR-0009, ARCHITECTURE §8.2): ToolLoopAgent AI SDK 7 с моделью из шлюза llm (цепочка по
// задаче chat, облако — по согласию пользователя) и инструментами набора core из реестра модулей; ctx.s инструментов
// строится из scope запуска (platform/tools/bind-tools.ts). Не больше MAX_STEPS шагов, на последнем — toolChoice
// "none": иначе при пределе текст ответа пуст. Ответ — поток UI-сообщения (UIMessageChunk) для useChat; по
// окончании onFinish получает итоговое сообщение (сохранение — у chat).
import {
  createAgentUIStream,
  isStepCount,
  tool,
  ToolLoopAgent,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { bindTools } from "../../../platform/tools/bind-tools.ts";
import type { ToolDef } from "../../../platform/tools/define-tool.ts";
import type { LlmFacade } from "../../llm/index.ts";
import { SYSTEM_PROMPT } from "../prompts/system.prompt.ts";

/** Набор инструментов запуска (ARCHITECTURE §8.2): пока один — core; выбор набора по странице — T-042. */
export const DEFAULT_TOOLSET = "core";

export interface RunAgentDeps {
  readonly llm: LlmFacade;
  /** Инструменты всех модулей (реестр корня композиции). */
  readonly tools: () => readonly ToolDef[];
  readonly scoped: Platform["scoped"];
  readonly log: Logger;
  readonly maxSteps: () => Promise<number>;
}

export interface AgentRun {
  /** История диалога в виде UI-сообщений; последнее — вопрос пользователя. */
  readonly messages: readonly UIMessage[];
  /** Остановка запуска («Стоп», остановка процесса) — не соединение клиента. */
  readonly abortSignal: AbortSignal;
  readonly requestId: string;
  /** Id диалога — для трасс (sessionId). */
  readonly sessionId: string;
  /** Метаданные первого куска ответа (start): runId и id диалога для сайта. */
  readonly metadata: Record<string, string>;
  /** Итог ответа: сообщение целиком и признак обрыва. */
  readonly onFinish: (message: UIMessage, aborted: boolean) => Promise<void>;
}

/** Набор core как ToolSet AI SDK: исполнители — из адаптера инструментов платформы. */
export function coreToolSet(
  d: Pick<RunAgentDeps, "tools" | "scoped" | "log">,
  s: ScopedDb,
  requestId: string,
): ToolSet {
  const bound = bindTools(
    d.tools().filter((t) => t.toolset === DEFAULT_TOOLSET),
    { scope: s.scope, scoped: d.scoped, requestId, channel: "web", log: d.log },
  );
  return Object.fromEntries(
    bound.map((b) => [
      b.name,
      tool({
        description: b.description,
        inputSchema: b.input,
        execute: (input) => b.execute(input),
      }),
    ]),
  );
}

export function makeRunAgent(d: RunAgentDeps) {
  return async function runAgent(
    s: ScopedDb,
    run: AgentRun,
  ): Promise<ReadableStream<UIMessageChunk>> {
    const maxSteps = await d.maxSteps();
    const { model, telemetry } = await d.llm.model(s.scope, "chat", { sessionId: run.sessionId });
    const agent = new ToolLoopAgent({
      model,
      instructions: SYSTEM_PROMPT,
      tools: coreToolSet(d, s, run.requestId),
      stopWhen: isStepCount(maxSteps),
      // AGT-01: на последнем шаге — без инструментов, чтобы агент ответил тем, что успел выяснить.
      prepareStep: ({ stepNumber }) => (stepNumber >= maxSteps - 1 ? { toolChoice: "none" } : {}),
      telemetry: telemetry.telemetry,
      runtimeContext: telemetry.runtimeContext,
    });
    return createAgentUIStream({
      agent,
      uiMessages: [...run.messages],
      abortSignal: run.abortSignal,
      messageMetadata: ({ part }) => (part.type === "start" ? run.metadata : undefined),
      onFinish: ({ responseMessage, isAborted }) => run.onFinish(responseMessage, isAborted),
    });
  };
}
