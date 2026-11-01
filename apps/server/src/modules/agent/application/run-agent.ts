// Запуск агента (AGT-01…13, ADR-0009, ARCHITECTURE §8.2, §8.3): поток ответа — UI-сообщение AI SDK. Порядок: кусок
// `start` → короткое «да/нет» и выбор варианта дозапроса (код, без модели) → стражи «вне темы» и защитный → выбор набора
// инструментов по странице и словам → цикл ToolLoopAgent (модель из шлюза llm, инструменты набора + `ask_user` и
// `make_chart`, не больше MAX_STEPS шагов, на последнем — без инструментов) → преобразование потока: предложения с проверкой
// чисел, правовой ответ через `finalizeAnswer`, график, пометки (answer-stream.ts). Данные — только ctx.s из scope запуска.
import type { PageContext } from "@kosht/contract";
import { createAgentT, type AgentT } from "@kosht/i18n";
import { LocalDate, type Clock } from "@kosht/kernel";
import {
  createUIMessageStream,
  isStepCount,
  tool,
  toUIMessageStream,
  ToolLoopAgent,
  type JSONValue,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import { bindTools } from "../../../platform/tools/bind-tools.ts";
import type { ToolChannel, ToolDef } from "../../../platform/tools/define-tool.ts";
import type { ActionsFacade } from "../../actions/index.ts";
import type { LegalConsultFacade } from "../../legal-consult/index.ts";
import { NumberLedger, type LlmFacade } from "../../llm/index.ts";
import type { ProfileFacade } from "../../profile/index.ts";
import { systemPrompt } from "../prompts/system.prompt.ts";
import { answerTransform, newRunState, type RunState } from "./answer-stream.ts";
import { ASK_USER, askUserTool } from "./ask-user.ts";
import { contextBlock } from "./context-block.ts";
import { modelHistory } from "./history.ts";
import { lawAnswer } from "./law-answer.ts";
import { MAKE_CHART, makeChartTool } from "./make-chart.ts";
import { answerShort } from "./short-answers.ts";
import { neutralizeOutput } from "./tool-output.ts";
import { toolInputSchema } from "./tool-schema.ts";
import { topicGuard } from "./topic-guard.ts";
import { inToolset, selectToolset } from "./toolsets.ts";

/** Инструменты права: после любого из них ответ — правовой (текст проходит finalizeAnswer). */
const LEGAL_TOOLS = new Set(["search_law", "get_law_fragment", "law_act_card"]);

export interface RunAgentDeps {
  readonly llm: LlmFacade;
  readonly actions: ActionsFacade;
  readonly profile: ProfileFacade;
  readonly legalConsult: LegalConsultFacade;
  /** Инструменты всех модулей (реестр корня композиции). */
  readonly tools: () => readonly ToolDef[];
  readonly scoped: Platform["scoped"];
  readonly log: Logger;
  readonly clock: Clock;
  readonly maxSteps: () => Promise<number>;
  /** Окно истории диалога, сообщений (AGT-08). */
  readonly historyMessages: () => Promise<number>;
}

export interface AgentRun {
  /** История диалога в виде UI-сообщений; последнее — вопрос пользователя. */
  readonly messages: readonly UIMessage[];
  /** Остановка запуска («Стоп», остановка процесса) — не соединение клиента. */
  readonly abortSignal: AbortSignal;
  readonly requestId: string;
  /** Id диалога — для трасс (sessionId). */
  readonly sessionId: string;
  /** Id ответа ассистента (строка сообщения в chat): AI SDK ставит его в кусок start. */
  readonly messageId: string;
  /** Метаданные первого куска ответа (start): runId и id диалога для сайта. */
  readonly metadata: Record<string, string>;
  /** Итог ответа: сообщение целиком и признак обрыва. */
  readonly onFinish: (message: UIMessage, aborted: boolean) => Promise<void>;
  /** Откуда запуск (AGT-11): сайт — по умолчанию; Telegram передаёт свой. */
  readonly channel?: ToolChannel;
  /** «Сегодня» запуска: бот — по времени отправки сообщения, а не обработки (TG-10); по умолчанию — часы системы. */
  readonly today?: LocalDate;
  /** Что пользователь видит на сайте (CHAT-08); идёт блоком данных в конце вопроса. */
  readonly page?: PageContext;
}

type Writer = Parameters<Parameters<typeof createUIMessageStream>[0]["execute"]>[0]["writer"];

const textOf = (message: UIMessage | undefined): string =>
  (message?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join(" ");

/** Набор инструментов запуска как ToolSet AI SDK: исполнители — адаптер платформы; числа результатов — в реестр чисел. */
function buildTools(
  d: RunAgentDeps,
  s: ScopedDb,
  run: AgentRun,
  defs: readonly ToolDef[],
  ledger: NumberLedger,
  state: RunState,
): ToolSet {
  const bound = bindTools(defs, {
    scope: s.scope,
    scoped: d.scoped,
    requestId: run.requestId,
    channel: run.channel ?? "web",
    ...(run.page === undefined ? {} : { page: run.page }),
    log: d.log,
  });
  const tools: ToolSet = Object.fromEntries(
    bound.map((b) => [
      b.name,
      tool({
        description: b.description,
        inputSchema: toolInputSchema(b.input),
        execute: async (input) => {
          const output = await b.execute(input);
          ledger.addJson(output);
          if (LEGAL_TOOLS.has(b.name)) {
            state.legalToolUsed = true;
            for (const id of actIdsOf(output)) state.candidateActIds.add(id);
          }
          return output;
        },
        // SEC-10: модель видит результат без инструктивных фраз из текстов документов; сайт и числа — исходный.
        toModelOutput: ({ output }) => {
          const clean = neutralizeOutput(output);
          if (clean.count > 0) d.log.warn({ count: clean.count }, "agent.tool-neutralized");
          return { type: "json", value: clean.value as JSONValue };
        },
      }),
    ]),
  );
  // Собственные инструменты агента: вопрос пользователю (без execute) и график (значения — из реестра чисел).
  return Object.assign(tools, {
    [ASK_USER]: askUserTool(),
    [MAKE_CHART]: makeChartTool(ledger, () => undefined),
  });
}

/** Акты из результата поиска по законам: карточки и фрагменты. */
function actIdsOf(output: unknown): string[] {
  const { cards, fragments } = (output ?? {}) as { cards?: unknown; fragments?: unknown };
  const ids = [
    ...(Array.isArray(cards) ? cards : []),
    ...(Array.isArray(fragments) ? fragments : []),
  ]
    .map((item) => (item as { actId?: unknown } | null)?.actId)
    .filter((id): id is string => typeof id === "string");
  return [...new Set(ids)];
}

export function makeRunAgent(d: RunAgentDeps) {
  const t: AgentT = createAgentT();

  /** Короткий ответ программы (без модели): текстовая часть и конец сообщения. */
  function reply(writer: Writer, text: string, extra: UIMessageChunk[] = []): void {
    writer.write({ type: "text-start", id: "reply" });
    writer.write({ type: "text-delta", id: "reply", delta: text });
    writer.write({ type: "text-end", id: "reply" });
    for (const chunk of extra) writer.write(chunk);
    writer.write({ type: "finish", finishReason: "stop" });
  }

  async function respond(writer: Writer, s: ScopedDb, run: AgentRun): Promise<void> {
    const channel = run.channel ?? "web";
    const question = textOf(run.messages.at(-1));
    // AGT-06, AGT-07: «да»/«нет» и выбор варианта дозапроса — кодом, до модели.
    const short = await answerShort({ actions: d.actions, profile: d.profile, log: d.log }, s, {
      messages: run.messages,
      channel,
    });
    if (short?.kind === "decision") {
      reply(writer, t(short.data.status === "yes" ? "actionDone" : "actionDeclined"), [
        { type: "data-action-result", data: short.data },
      ]);
      return;
    }
    if (short?.kind === "failed") {
      reply(writer, t("actionFailed"));
      return;
    }
    // AGT-12, SEC-10, P6: стражи до дорогого цикла.
    const verdict = await topicGuard({ llm: d.llm, log: d.log }, s.scope, {
      text: question,
      hasHistory: run.messages.some((message) => message.role === "assistant"),
    });
    if (verdict !== "pass") {
      d.log.info({ reason: verdict }, "agent.guard-refused");
      reply(writer, t(verdict === "off-topic" ? "offTopic" : verdict));
      return;
    }
    await runLoop(writer, s, run, question, short?.kind === "fact" ? short.factKey : undefined);
  }

  async function runLoop(
    writer: Writer,
    s: ScopedDb,
    run: AgentRun,
    question: string,
    recordedFact: string | undefined,
  ): Promise<void> {
    const [maxSteps, window] = await Promise.all([d.maxSteps(), d.historyMessages()]);
    const today = run.today ?? d.clock.today();
    const choice = selectToolset({ text: question, route: run.page?.route });
    d.log.info({ reason: `${choice.toolset}:${choice.reason}` }, "agent.toolset");
    // P1: числа ответа — из результатов инструментов, сообщений диалога, сегодняшней даты и параметров страницы.
    const ledger = new NumberLedger();
    for (const message of run.messages)
      if (message.role === "user") ledger.addText(textOf(message));
    const yesterday = LocalDate.addDays(today, -1);
    ledger.addText(`${today} ${yesterday}`);
    ledger.addText(Object.values(run.page?.params ?? {}).join(" "));
    const state = newRunState();
    const block = contextBlock({ today, yesterday, page: run.page, recordedFact });
    if (block.neutralized > 0)
      d.log.warn({ count: block.neutralized }, "agent.context-neutralized");
    const prompt = await modelHistory(run.messages, { window, contextBlock: block.text });
    const defs = d.tools().filter((def) => inToolset(def.toolset, choice.toolset));
    const tools = buildTools(d, s, run, defs, ledger, state);
    const { model, telemetry } = await d.llm.model(s.scope, "chat", { sessionId: run.sessionId });
    const agent = new ToolLoopAgent({
      model,
      instructions: systemPrompt(choice.toolset),
      tools,
      stopWhen: isStepCount(maxSteps),
      // AGT-01: на последнем шаге — без инструментов, чтобы агент ответил тем, что успел выяснить.
      prepareStep: ({ stepNumber }) => {
        if (stepNumber < maxSteps - 1) return {};
        state.stepLimitHit = true;
        return { toolChoice: "none" };
      },
      telemetry: telemetry.telemetry,
      runtimeContext: telemetry.runtimeContext,
    });
    const result = await agent.stream({
      prompt,
      abortSignal: run.abortSignal,
      onStepEnd: (step) => {
        const kosht = step.providerMetadata?.["kosht"] as
          | { model?: unknown; unavailable?: unknown }
          | undefined;
        if (typeof kosht?.model === "string") {
          state.answeredBy = {
            model: kosht.model,
            unavailable: Array.isArray(kosht.unavailable)
              ? kosht.unavailable.filter((m): m is string => typeof m === "string")
              : [],
          };
        }
      },
    });
    const ui = toUIMessageStream({
      stream: result.stream,
      tools,
      sendStart: false,
      sendReasoning: false,
      onError: () => "agent-error",
    });
    writer.merge(
      ui.pipeThrough(
        answerTransform({
          ledger,
          state,
          t,
          log: d.log,
          legalMode: choice.toolset === "legal",
          finalizeLaw: (draft) =>
            lawAnswer({ legalConsult: d.legalConsult, llm: d.llm, log: d.log }, s.scope, {
              draft,
              question,
              candidateActIds: [...state.candidateActIds],
            }),
        }),
      ),
    );
  }

  return async function runAgent(
    s: ScopedDb,
    run: AgentRun,
  ): Promise<ReadableStream<UIMessageChunk>> {
    return createUIMessageStream({
      generateId: () => run.messageId,
      execute: async ({ writer }) => {
        writer.write({ type: "start", messageId: run.messageId, messageMetadata: run.metadata });
        try {
          await respond(writer, s, run);
        } catch (error) {
          // AGT-13: сбой посреди запуска не обрывает диалог — честное сообщение (без текста ошибки, OBS-04).
          if (run.abortSignal.aborted) throw error;
          d.log.error({ err: error, code: "RUN_FAILED" }, "agent.run-failed");
          reply(writer, t("modelUnavailable"));
        }
      },
      onError: () => "agent-error",
      onEnd: ({ responseMessage, isAborted }) => run.onFinish(responseMessage, isAborted),
    });
  };
}
