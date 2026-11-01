// Сообщение ассистенту (CHAT-02, NFR-21, ARCHITECTURE §8.3): вопрос пользователя и строка ответа «идёт» — в одной
// транзакции; запуск агента — в реестре запусков (не привязан к соединению); ответ — поток кусков с первого.
// По окончании (и при «Стоп») ответ сохраняется частями UI-сообщения, сайт получает сигнал chat-message.
// Модель зовётся вне транзакции (llm бросит LLM_IN_TRANSACTION). Ограничение частоты (SEC-02) — до записи вопроса.
import {
  AnswerMetadata,
  ConversationId,
  RunId,
  type PageContext,
  type RunMetadata,
} from "@kosht/contract";
import type { UIMessage, UIMessageChunk } from "ai";
import { randomUUID } from "node:crypto";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { AgentFacade } from "../../agent/index.ts";
import { conversationTitle } from "../domain/conversation-title.ts";
import {
  conversationExists,
  createConversation,
  finishMessage,
  insertMessage,
  listMessages,
  type MessageRow,
} from "../infrastructure/db/chat.repo.ts";
import type { LiveRuns } from "./live-runs.ts";
import { enforceChatRate } from "./rate-limit.ts";
import type { RunRegistry } from "./runs.ts";

export interface SendDeps {
  readonly agent: AgentFacade;
  readonly runs: RunRegistry;
  readonly live: LiveRuns;
  readonly platform: Pick<Platform, "realtime" | "log" | "rateLimiter" | "settings">;
}

/** Сохранённое сообщение → UI-сообщение AI SDK для истории агента (строки «идёт» и оборванные — как есть). */
export function toUiMessage(row: MessageRow): UIMessage {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    parts: Array.isArray(row.parts) ? (row.parts as UIMessage["parts"]) : [],
  };
}

export function runKey(s: ScopedDb, runId: string): string {
  return `${s.scope.householdId}:${runId}`;
}

/**
 * Поток запуска, который гарантированно сообщает о конце: сбой посреди потока (ошибка агента, обрыв провайдера) не
 * вызывает `flush` у TransformStream, и ответ остался бы «идёт» навсегда — здесь и конец, и ошибка доводят `onEnd`.
 */
function guarded(
  stream: ReadableStream<UIMessageChunk>,
  onEnd: () => Promise<void>,
): ReadableStream<UIMessageChunk> {
  const reader = stream.getReader();
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await onEnd();
          controller.close();
        } else controller.enqueue(value);
      } catch (error) {
        await onEnd();
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await onEnd();
    },
  });
}

export function makeSendMessage(d: SendDeps) {
  return async function sendMessage(
    s: ScopedDb,
    input: {
      readonly conversationId?: ConversationId | undefined;
      readonly text: string;
      readonly page?: PageContext | undefined;
    },
    requestId: string,
  ): Promise<ReadableStream<UIMessageChunk>> {
    // SEC-02: до записи вопроса, чтобы отказ не оставлял сообщение без ответа.
    await enforceChatRate(d.platform, s.scope.userId);
    const controller = new AbortController();
    const assistantId = randomUUID();
    const householdId = s.scope.householdId;
    let conversationId: string;
    try {
      conversationId = await s.transaction(async (tx) => {
        const id =
          input.conversationId ?? (await createConversation(tx, conversationTitle(input.text)));
        if (input.conversationId !== undefined && !(await conversationExists(tx, id))) {
          throw new AppError("NOT_FOUND");
        }
        // Запуск «живой» до записи строки «идёт»: чтение между коммитом и стартом не примет её за зависшую.
        d.live.add(householdId, assistantId, { conversationId: id, controller });
        await insertMessage(tx, {
          conversationId: id,
          role: "user",
          parts: [{ type: "text", text: input.text }],
          status: "complete",
        });
        await insertMessage(tx, {
          id: assistantId,
          conversationId: id,
          role: "assistant",
          parts: [],
          status: "streaming",
        });
        return id;
      });
    } catch (error) {
      d.live.remove(householdId, assistantId);
      throw error;
    }
    const history = (await listMessages(s, conversationId))
      .filter((row) => row.id !== assistantId)
      .map(toUiMessage);
    const runId = randomUUID();
    const metadata: RunMetadata = {
      runId: RunId.parse(runId),
      conversationId: ConversationId.parse(conversationId),
    };
    let saved = false;
    const save = async (
      parts: unknown,
      status: "complete" | "interrupted",
      answeredBy?: unknown,
    ) => {
      if (saved) return;
      saved = true;
      try {
        await finishMessage(s, assistantId, parts, status, answeredBy);
        await d.platform.realtime.changed(s, { entity: "chat-message", ids: [assistantId] });
        d.platform.log.info({ messageId: assistantId, status }, "chat.answered");
      } finally {
        d.live.remove(householdId, assistantId);
      }
    };
    let stream: ReadableStream<UIMessageChunk>;
    try {
      stream = await d.agent.run(s, {
        messages: history,
        abortSignal: controller.signal,
        requestId,
        sessionId: conversationId,
        messageId: assistantId,
        metadata,
        ...(input.page === undefined ? {} : { page: input.page }),
        onFinish: (message, aborted) =>
          save(
            message.parts,
            aborted ? "interrupted" : "complete",
            AnswerMetadata.safeParse(message.metadata).data?.answeredBy,
          ),
      });
    } catch (error) {
      await save([], "interrupted");
      throw error;
    }
    const key = runKey(s, runId);
    d.runs.start(
      key,
      guarded(stream, () => save([], "interrupted")),
      controller,
    );
    const subscription = d.runs.subscribe(key);
    if (subscription === undefined) throw new AppError("UNAVAILABLE");
    return subscription;
  };
}

/** «Стоп» (CHAT-02): запуск своего домохозяйства; чужой или законченный — NOT_FOUND. */
export function makeStopRun(d: Pick<SendDeps, "runs">) {
  return function stopRun(s: ScopedDb, runId: string): void {
    if (!d.runs.stop(runKey(s, runId))) throw new AppError("NOT_FOUND");
  };
}
