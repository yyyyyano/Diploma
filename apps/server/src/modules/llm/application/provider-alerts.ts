// Уведомления администратору о провайдерах ИИ (NOTIF-03, вид ai-provider): исчерпан лимит или провайдер отвечает
// ошибкой. Ключ — «провайдер + вид + день» (день — по Clock в поясе системы): повторов за день нет, notifications
// идемпотентен по виду и ключу. Параметры — провайдер и причина; ни моделей пользователя, ни текстов.
import type { Clock } from "@kosht/kernel";
import type { NotificationsFacade } from "../../notifications/index.ts";
import type { ChainEvent } from "./chained-model.ts";

export function makeProviderAlerts(d: {
  readonly clock: Pick<Clock, "today">;
  readonly notifications: Pick<NotificationsFacade, "notifyAdmins">;
}) {
  return async function alert(event: ChainEvent): Promise<void> {
    await d.notifications.notifyAdmins({
      kind: "ai-provider",
      key: `${event.provider}:${event.kind}:${String(d.clock.today())}`,
      params: { provider: event.provider, reason: event.kind },
    });
  };
}
