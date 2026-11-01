// Транспорт useChat поверх процедур oRPC (ARCHITECTURE §8.3, §10.3): вопрос уходит chat.send, ответ — итератор
// событий oRPC, который eventIteratorToUnproxiedDataStream превращает обратно в поток кусков UI-сообщения для useChat.
// Те же сессия, ошибки и requestId, что у остальных процедур; через прокси Vite — как любой /api. Диалог транспорт
// запоминает сам: из истории или из метаданных куска start первого ответа (RunMetadata).
// Отмена запроса (useChat.stop) только отписывает вкладку — запуск на сервере останавливает chat.stop(runId).
import { ConversationId, PageContext, RunMetadata } from "@kosht/contract";
import { eventIteratorToUnproxiedDataStream } from "@orpc/client";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type { ApiClient } from "../../../lib/api.ts";

/** Текст вопроса — текстовые части последнего сообщения пользователя. */
export function questionOf(messages: readonly UIMessage[]): string {
  const last = messages.at(-1);
  return (last?.parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

/**
 * Контекст страницы (CHAT-08) приходит в `body` вопроса (`sendMessage(…, { body: { page } })`) — на момент вопроса, а не
 * создания транспорта: за время диалога пользователь переходит между страницами. Не по схеме — не отправляется.
 */
export function createChatTransport(
  client: ApiClient,
  initial: ConversationId | null,
): ChatTransport<UIMessage> {
  let conversationId: ConversationId | undefined = initial ?? undefined;
  return {
    async sendMessages({ messages, abortSignal, body }) {
      const page = PageContext.safeParse((body as { page?: unknown } | undefined)?.page).data;
      const iterator = await client.chat.send(
        {
          text: questionOf(messages),
          ...(conversationId === undefined ? {} : { conversationId }),
          ...(page === undefined ? {} : { page }),
        },
        abortSignal === undefined ? {} : { signal: abortSignal },
      );
      // Схема кусков в контракте слабая («объект с type»): форму кусков проверяет сам useChat.
      const stream = eventIteratorToUnproxiedDataStream(iterator) as ReadableStream<UIMessageChunk>;
      return stream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform(chunk, controller) {
            if (chunk.type === "start") {
              const meta = RunMetadata.safeParse(chunk.messageMetadata);
              if (meta.success) conversationId = ConversationId.parse(meta.data.conversationId);
            }
            controller.enqueue(chunk);
          },
        }),
      );
    },
    // Идущий ответ после перезагрузки не подхватывается: чат показывает «ещё отвечает» и обновляется по сигналу
    // chat-message (CHAT-02); закончившийся ответ приходит историей.
    reconnectToStream: async () => null,
  };
}
