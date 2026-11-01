// Настройки voice: ограничение частоты распознавания (SEC-02) — запись уходит облачной модели (лимиты Groq Whisper:
// 20 запросов в минуту, 2000 в сутки на весь проект) или греет процессор локальной. Ключ — пользователь.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** Записей на распознавание в минуту на пользователя; больше — RATE_LIMITED. */
export const VOICE_RATE_PER_MINUTE = defineSetting({
  key: "voice.rate-per-minute",
  schema: z.int().min(1).max(120),
  default: 10,
});

/** Записей на распознавание в сутки на пользователя. */
export const VOICE_RATE_PER_DAY = defineSetting({
  key: "voice.rate-per-day",
  schema: z.int().min(1).max(5000),
  default: 200,
});

export const VOICE_SETTINGS = [VOICE_RATE_PER_MINUTE, VOICE_RATE_PER_DAY];
