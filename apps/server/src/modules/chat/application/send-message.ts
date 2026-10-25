// Сообщение ассистенту (CHAT-02, NFR-21, ARCHITECTURE §8.3): вопрос пользователя и строка ответа «идёт» — в одной
// транзакции; запуск агента — в реестре запусков (не привязан к соединению); ответ — поток кусков с первого.
// По окончании (и при «Стоп») ответ сохраняется частями UI-сообщения, сайт получает сигнал chat-message.
// Модель зовётся вне транзакции (llm бросит LLM_IN_TRANSACTION).
import { ChatMessage, ConversationId, RunId, type RunMetadata } from "@kosht/contract";
import type { UIMessage, UIMessageChunk } from "ai";
import { randomUUID } from "node:crypto";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { AgentFacade } from "../../agent/index.ts";
import {
  conversationExists,
  createConversation,
  finishMessage,
  insertMessage,
  latestConversation,
  listMessages,
  type MessageRow,
} from "../infrastructure/db/chat.repo.ts";
import type { RunRegistry } from "./runs.ts";

export interface SendDeps {
  readonly agent: AgentFacade;
  readonly runs: RunRegistry;
  readonly platform: Pick<Platform, "realtime" | "log">;
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

export function makeSendMessage(d: SendDeps) {
  return async function sendMessage(
    s: ScopedDb,
    input: { readonly conversationId?: ConversationId | undefined; readonly text: string },
    requestId: string,
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { conversationId, assistantId } = await s.transaction(async (tx) => {
      const id = input.conversationId ?? (await createConversation(tx));
      if (input.conversationId !== undefined && !(await conversationExists(tx, id))) {
        throw new AppError("NOT_FOUND");
      }
      await insertMessage(tx, {
        conversationId: id,
        role: "user",
        parts: [{ type: "text", text: input.text }],
        status: "complete",
      });
      const assistant = await insertMessage(tx, {
        conversationId: id,
        role: "assistant",
        parts: [],
        status: "streaming",
      });
      return { conversationId: id, assistantId: assistant };
    });
    const history = (await listMessages(s, conversationId))
      .filter((row) => row.id !== assistantId)
      .map(toUiMessage);
    const runId = randomUUID();
    const controller = new AbortController();
    const metadata: RunMetadata = {
      runId: RunId.parse(runId),
      conversationId: ConversationId.parse(conversationId),
    };
    let saved = false;
    const save = async (parts: unknown, status: "complete" | "interrupted") => {
      if (saved) return;
      saved = true;
      await finishMessage(s, assistantId, parts, status);
      await d.platform.realtime.changed(s, { entity: "chat-message", ids: [assistantId] });
      d.platform.log.info({ messageId: assistantId, status }, "chat.answered");
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
        onFinish: (message, aborted) => save(message.parts, aborted ? "interrupted" : "complete"),
      });
    } catch (error) {
      await save([], "interrupted");
      throw error;
    }
    // Запуск закончился без onFinish (сбой посреди потока) — ответ всё равно не остаётся «идёт».
    const key = runKey(s, runId);
    d.runs.start(
      key,
      stream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          flush: () => save([], "interrupted"),
        }),
      ),
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

/** Последний диалог и его сообщения (CHAT-01; список диалогов — T-043). */
export function makeHistory() {
  return async function history(s: ScopedDb) {
    const conversationId = await latestConversation(s);
    if (conversationId === undefined) return { conversationId: null, messages: [] };
    const rows = await listMessages(s, conversationId);
    return {
      conversationId: ConversationId.parse(conversationId),
      // Сохранённое — то, что построил AI SDK; схема ответа проверяет форму ещё раз.
      messages: rows.map((row) =>
        ChatMessage.parse({
          id: row.id,
          role: row.role,
          parts: Array.isArray(row.parts) ? row.parts : [],
          status: row.status,
        }),
      ),
    };
  };
}
