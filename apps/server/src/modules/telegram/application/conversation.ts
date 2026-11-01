// Вопросы ассистенту текстом и голосом (TG-05, VOICE-01, AGT-11): тот же агент, что на сайте, со своей историей канала.
// Ответ уходит потоком (черновики Telegram) обычным текстом без разметки — Markdown модели очищается (SEC-05).
// Голос: распознаёт облачный Whisper при согласии; без согласия или при сбое облака — честный отказ, локальный whisper.cpp
// в этой фазе не запускается.
import { randomUUID } from "node:crypto";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { createPlainTextStream } from "../domain/plain-text.ts";
import { IDLE_HOURS, VOICE_MAX_SECONDS, MAX_FILE_MB } from "../settings.ts";
import type { TelegramDeps } from "./deps.ts";
import type { BotApi, Origin } from "./ports.ts";

/** Кусок потока ответа агента: нужен только текст (в поток UI-сообщения AI SDK входят и другие виды кусков). */
interface AnswerChunk {
  readonly type: string;
  readonly delta?: unknown;
}

export function makeConversation(d: TelegramDeps) {
  const { t, platform, neighbours } = d;

  /** Текстовые куски ответа без Markdown; пустой ответ — вежливая фраза; сбой до первого знака — ошибка (ответ — «не получилось»). */
  async function* answerText(stream: AsyncIterable<AnswerChunk>): AsyncGenerator<string> {
    const plain = createPlainTextStream();
    let sent = false;
    let failed = false;
    for await (const chunk of stream) {
      if (chunk.type === "error") failed = true;
      if (chunk.type !== "text-delta" || typeof chunk.delta !== "string") continue;
      const out = plain.push(chunk.delta);
      if (out !== "") {
        sent = true;
        yield out;
      }
    }
    const rest = plain.end();
    if (rest !== "") {
      sent = true;
      yield rest;
    }
    if (!sent) {
      if (failed) throw new AppError("UNAVAILABLE");
      yield t("bot.emptyAnswer");
    }
  }

  /** Вопрос агенту: диалог канала, «сегодня» — по времени отправки (TG-10). */
  async function ask(s: ScopedDb, origin: Origin, text: string, api: BotApi): Promise<void> {
    const idleHours = await platform.settings.get(IDLE_HOURS);
    const stream = await neighbours.chat.ask(
      s,
      { text, channel: "telegram", sentAt: origin.sentAt, idleMs: idleHours * 3_600_000 },
      randomUUID(),
    );
    await api.stream(origin.chatId, answerText(stream));
  }

  /** Голосовое сообщение → текст → тот же путь, что у текста. Длинное — отказ по `voice.duration` до скачивания. */
  async function voice(
    s: ScopedDb,
    origin: Origin,
    message: { readonly fileId: string; readonly duration: number },
    api: BotApi,
  ): Promise<void> {
    const maxSeconds = await platform.settings.get(VOICE_MAX_SECONDS);
    if (message.duration > maxSeconds) {
      await api.send(origin.chatId, t("bot.voice.tooLong", { seconds: maxSeconds }));
      return;
    }
    // VOICE-01: без облачного согласия распознавать нечем (локальный whisper.cpp в фазе 8 не запускается).
    if (!(await platform.consent.cloudAllowed(s.scope))) {
      await api.send(origin.chatId, t("bot.voice.unavailable"));
      return;
    }
    const maxMb = await platform.settings.get(MAX_FILE_MB);
    const audio = await api.download(message.fileId, maxMb * 1024 * 1024);
    let text: string;
    try {
      text = await neighbours.voice.transcribe(s, audio);
    } catch (error) {
      if (error instanceof AppError && error.code === "UNAVAILABLE") {
        platform.log.warn({ code: error.code }, "telegram.voice-unavailable");
        await api.send(origin.chatId, t("bot.voice.unavailable"));
        return;
      }
      throw error;
    }
    if (text === "") {
      await api.send(origin.chatId, t("bot.voice.empty"));
      return;
    }
    await ask(s, origin, text, api);
  }

  return { ask, voice };
}

export type Conversation = ReturnType<typeof makeConversation>;
