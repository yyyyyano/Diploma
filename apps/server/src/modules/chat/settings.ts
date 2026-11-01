// Настройки chat: ограничение частоты запросов к ассистенту (SEC-02) — модель стоит денег и лимитов провайдера,
// а цикл на странице или скрипт не должны её выжигать. Окно — минута и сутки, ключ — пользователь.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** SEC-02: сообщений ассистенту в минуту на пользователя; больше — RATE_LIMITED с «через N мин.». */
export const RATE_PER_MINUTE = defineSetting({
  key: "chat.rate-per-minute",
  schema: z.int().min(1).max(600),
  default: 20,
});

/** SEC-02: сообщений ассистенту в сутки на пользователя. */
export const RATE_PER_DAY = defineSetting({
  key: "chat.rate-per-day",
  schema: z.int().min(1).max(10_000),
  default: 300,
});

export const CHAT_SETTINGS = [RATE_PER_MINUTE, RATE_PER_DAY];
