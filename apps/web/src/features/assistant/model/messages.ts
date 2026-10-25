// Сообщения истории (chat.history) → UI-сообщения AI SDK для useChat: части сохранены сервером как построил их AI SDK.
import type { ChatMessage } from "@kosht/contract";
import type { UIMessage } from "ai";

export function toUiMessages(messages: readonly ChatMessage[]): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts as UIMessage["parts"],
    metadata: { status: message.status },
  }));
}

/** Метаданные ответа: runId и id диалога из куска start (сервер, RunMetadata) или состояние из истории. */
export interface AnswerMetadata {
  readonly runId?: string;
  readonly conversationId?: string;
  readonly status?: ChatMessage["status"];
}

export function metadataOf(message: UIMessage | undefined): AnswerMetadata {
  const metadata = message?.metadata;
  return typeof metadata === "object" && metadata !== null ? (metadata as AnswerMetadata) : {};
}
