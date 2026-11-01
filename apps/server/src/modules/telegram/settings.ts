// Настройки telegram (TG-02, TG-05, VOICE-01) и секрет — токен бота (NFR-16: поле только для записи).
import { z } from "zod";
import { defineSecret } from "../../platform/secrets/secrets.ts";
import { defineSetting } from "../../platform/settings/settings.ts";

/** Токен бота (BotFather): значение из админки важнее `TELEGRAM_BOT_TOKEN` из `.env` (запасной, у разработчика). */
export const TELEGRAM_TOKEN = defineSecret({
  name: "telegram.bot-token",
  env: "TELEGRAM_BOT_TOKEN",
});

/** Сколько минут действует ссылка привязки (TG-02). */
export const LINK_CODE_TTL_MIN = defineSetting({
  key: "telegram.link-code-ttl-min",
  schema: z.int().min(1).max(60),
  default: 10,
});

/** Голосовое длиннее — отказ по полю `voice.duration` ещё до скачивания (VOICE-01). */
export const VOICE_MAX_SECONDS = defineSetting({
  key: "telegram.voice-max-seconds",
  schema: z.int().min(5).max(300),
  default: 60,
});

/** Тишина, после которой разговор с ботом начинается с чистого контекста (TG-05), часов. */
export const IDLE_HOURS = defineSetting({
  key: "telegram.idle-hours",
  schema: z.int().min(1).max(168),
  default: 6,
});

/** Предел размера файла из Telegram (Bot API отдаёт до 20 МБ), МБ: больше — «загрузите на сайте». */
export const MAX_FILE_MB = defineSetting({
  key: "telegram.max-file-mb",
  schema: z.int().min(1).max(20),
  default: 20,
});

/** Как часто опрашивающий процесс повторяет попытку взять блокировку опроса, секунд (TG-10: второй экземпляр ждёт). */
export const POLL_LOCK_RETRY_SEC = defineSetting({
  key: "telegram.poll-lock-retry-sec",
  schema: z.int().min(1).max(300),
  default: 10,
});

/** Как долго бот ждёт распознавания чека или разбора выписки, прежде чем сказать «не дождался», секунд. */
export const DOCUMENT_WAIT_SEC = defineSetting({
  key: "telegram.document-wait-sec",
  schema: z.int().min(10).max(900),
  default: 180,
});

export const TELEGRAM_SETTINGS = [
  LINK_CODE_TTL_MIN,
  VOICE_MAX_SECONDS,
  IDLE_HOURS,
  MAX_FILE_MB,
  POLL_LOCK_RETRY_SEC,
  DOCUMENT_WAIT_SEC,
];
