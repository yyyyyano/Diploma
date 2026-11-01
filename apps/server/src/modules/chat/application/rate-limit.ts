// SEC-02: ограничение частоты запросов к ассистенту — в минуту и в сутки на пользователя (настройки chat.rate-per-*).
// Минутное правило проверяется первым: отказ по нему не съедает суточную квоту. Превышение — RATE_LIMITED с
// «через N мин.» (platform/rate-limit); база счётчиков недоступна — UNAVAILABLE, а не «пропустить».
import type { Platform } from "../../../platform/module/define-module.ts";
import { defineRateRule } from "../../../platform/rate-limit/rate-limit.ts";
import { RATE_PER_DAY, RATE_PER_MINUTE } from "../settings.ts";

export async function enforceChatRate(
  platform: Pick<Platform, "rateLimiter" | "settings">,
  userId: string,
): Promise<void> {
  const [perMinute, perDay] = await Promise.all([
    platform.settings.get(RATE_PER_MINUTE),
    platform.settings.get(RATE_PER_DAY),
  ]);
  await platform.rateLimiter.enforce(
    defineRateRule({ name: "chat.send-minute", limit: perMinute, windowMs: 60_000 }),
    userId,
  );
  await platform.rateLimiter.enforce(
    defineRateRule({ name: "chat.send-day", limit: perDay, windowMs: 86_400_000 }),
    userId,
  );
}
