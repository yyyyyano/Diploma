// Обновление Telegram → нормализованное событие бота (grammY — только здесь и рядом). Редактирование сообщений, добавление в
// чат и прочее, кроме сообщений и нажатий кнопок, — не событие бота. Тексты команд и вложения разбираются здесь, чтобы
// сценарии не зависели от формы Update.
import type { Update } from "grammy/types";
import type { BotEvent, Incoming } from "../../application/ports.ts";

const COMMAND = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/u;

function commandEvent(text: string): BotEvent | undefined {
  const match = COMMAND.exec(text.trim());
  if (match === null) return undefined;
  const name = match[1]?.toLowerCase();
  if (name === "start") return { kind: "start", argument: match[2] ?? "" };
  if (name === "new" || name === "unlink" || name === "help") return { kind: "command", name };
  // Неизвестная команда (в т. ч. команды следующих задач) — подсказка, а не вопрос агенту.
  return { kind: "command", name: "help" };
}

export function toIncoming(update: Update): Incoming | undefined {
  const callback = update.callback_query;
  if (callback?.message !== undefined) {
    const { message } = callback;
    return {
      origin: {
        chatId: message.chat.id,
        fromId: callback.from.id,
        chatType: message.chat.type,
        username: callback.from.username ?? null,
        sentAt: new Date(),
      },
      event: {
        kind: "callback",
        callbackId: callback.id,
        messageId: message.message_id,
        text: "text" in message && typeof message.text === "string" ? message.text : "",
        data: callback.data ?? "",
      },
    };
  }
  const message = update.message;
  if (message === undefined || message.from === undefined) return undefined;
  const origin = {
    chatId: message.chat.id,
    fromId: message.from.id,
    chatType: message.chat.type,
    username: message.from.username ?? null,
    // TG-10: время отправки в Telegram, а не обработки — «потратил сегодня» из старого сообщения считается по нему.
    sentAt: new Date(message.date * 1000),
  };
  if (message.text !== undefined) {
    const event = message.text.startsWith("/")
      ? commandEvent(message.text)
      : ({ kind: "text", text: message.text } as const);
    return event === undefined ? undefined : { origin, event };
  }
  if (message.photo !== undefined && message.photo.length > 0) {
    // Самое большое из присланных размеров.
    const largest = message.photo.reduce((best, size) =>
      size.width * size.height > best.width * best.height ? size : best,
    );
    return { origin, event: { kind: "photo", fileId: largest.file_id, size: largest.file_size } };
  }
  if (message.document !== undefined) {
    const { document } = message;
    return {
      origin,
      event: {
        kind: "document",
        fileId: document.file_id,
        name: document.file_name ?? "document",
        mime: document.mime_type,
        size: document.file_size,
      },
    };
  }
  if (message.voice !== undefined) {
    return {
      origin,
      event: { kind: "voice", fileId: message.voice.file_id, duration: message.voice.duration },
    };
  }
  return { origin, event: { kind: "unsupported" } };
}
