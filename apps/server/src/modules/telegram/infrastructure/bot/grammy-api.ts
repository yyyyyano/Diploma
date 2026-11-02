// BotApi поверх grammY `Api` (TG-03…05, SEC-05): обычный текст без parse_mode, кнопки — встроенная клавиатура. Ответ потоком —
// `streamMessage` официального плагина `@grammyjs/stream` (черновики `sendMessageDraft`, деление на сообщения по 4096 знаков)
// поверх auto-retry; ошибка черновика — ответ уходит одним сообщением (куски по 4096). Токен в логи и ошибки не попадает.
import { InlineKeyboard, InputFile, type Api } from "grammy";
import { streamApi } from "@grammyjs/stream";
import type { Logger } from "../../../../platform/logging/logger.ts";
import { FileTooLargeError, type BotApi, type Keyboard } from "../../application/ports.ts";

/** Предел текста одного сообщения Telegram. */
const MESSAGE_LIMIT = 4096;

export interface GrammyApiOptions {
  readonly api: Api;
  /** Токен нужен только для адреса скачивания файла и в лог не пишется. */
  readonly token: string;
  readonly log: Pick<Logger, "warn">;
  /** Скачивание по адресу файла Telegram (порт: в тестах — подмена, сети нет). */
  readonly fetchBytes?: (url: string, maxBytes: number) => Promise<Uint8Array>;
}

function markup(keyboard: Keyboard | undefined) {
  if (keyboard === undefined || keyboard.length === 0) return { inline_keyboard: [] };
  const result = new InlineKeyboard();
  keyboard.forEach((row, index) => {
    if (index > 0) result.row();
    for (const button of row) {
      if (button.url !== undefined) result.url(button.text, button.url);
      else result.text(button.text, button.data ?? "");
    }
  });
  return result;
}

function pieces(text: string): string[] {
  const result: string[] = [];
  for (let at = 0; at < text.length; at += MESSAGE_LIMIT)
    result.push(text.slice(at, at + MESSAGE_LIMIT));
  return result;
}

/** Скачать с пределом: по заявленной длине и по факту (заголовок может не прийти). */
async function fetchWithLimit(url: string, maxBytes: number): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Файл Telegram не скачан: HTTP ${String(response.status)}.`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new FileTooLargeError();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new FileTooLargeError();
  return bytes;
}

export function createBotApi(options: GrammyApiOptions): BotApi {
  const { api, token, log } = options;
  const streamer = streamApi(api.raw);
  const fetchBytes = options.fetchBytes ?? fetchWithLimit;
  return {
    async send(chatId, text, keyboard) {
      // Длинный текст делится по 4096; кнопки — под последним куском.
      const parts = pieces(text);
      let last = 0;
      for (const [index, part] of parts.entries()) {
        const isLast = index === parts.length - 1;
        const withKeyboard = isLast && keyboard !== undefined && keyboard.length > 0;
        const sent = withKeyboard
          ? await api.sendMessage(chatId, part, { reply_markup: markup(keyboard) })
          : await api.sendMessage(chatId, part);
        last = sent.message_id;
      }
      return last;
    },
    async edit(chatId, messageId, text, keyboard) {
      await api.editMessageText(chatId, messageId, text.slice(0, MESSAGE_LIMIT), {
        reply_markup: markup(keyboard) as never,
      });
    },
    async sendPhoto(chatId, png, caption, keyboard) {
      const options = {
        caption: caption.slice(0, MESSAGE_LIMIT / 4),
        ...(keyboard !== undefined && keyboard.length > 0
          ? { reply_markup: markup(keyboard) }
          : {}),
      };
      await api.sendPhoto(chatId, new InputFile(png, "chart.png"), options);
    },
    async stream(chatId, text) {
      const iterator = text[Symbol.asyncIterator]();
      const collected: string[] = [];
      let sourceFailed = false;
      async function* tee(): AsyncGenerator<string> {
        for (;;) {
          let step: IteratorResult<string>;
          try {
            step = await iterator.next();
          } catch (error) {
            sourceFailed = true;
            throw error;
          }
          if (step.done === true) return;
          collected.push(step.value);
          yield step.value;
        }
      }
      try {
        // Смещение номеров черновиков — случайное: два потока одного чата подряд не делят черновик.
        await streamer.streamMessage(chatId, Math.floor(Math.random() * 1_000_000) + 1, tee());
      } catch (error) {
        // Ошибка источника (агент) — не про черновики: её разбирает вызывающий.
        if (sourceFailed) throw error;
        log.warn({ err: error }, "telegram.stream-fallback");
        for (;;) {
          const step = await iterator.next();
          if (step.done === true) break;
          collected.push(step.value);
        }
        for (const part of pieces(collected.join(""))) await api.sendMessage(chatId, part);
      }
    },
    async download(fileId, maxBytes, knownSize) {
      if (knownSize !== undefined && knownSize > maxBytes) throw new FileTooLargeError();
      const file = await api.getFile(fileId);
      if (file.file_size !== undefined && file.file_size > maxBytes) throw new FileTooLargeError();
      if (file.file_path === undefined) throw new Error("Telegram не отдал путь к файлу.");
      return fetchBytes(`https://api.telegram.org/file/bot${token}/${file.file_path}`, maxBytes);
    },
    async leave(chatId) {
      await api.leaveChat(chatId);
    },
    async answerCallback(callbackId) {
      await api.answerCallbackQuery(callbackId);
    },
  };
}
