// Публикация системных событий общей базы (законы): от имени первого администратора — фасадом
// `identity.publishSystemEvent` (ScopedDb администратора из identity не выходит), транзакция — одна на событие. Администратора
// ещё нет — событие не публикуется (системы нет, подписчикам нечего пересчитывать).
import type { EventDef } from "../../../platform/events/define-event.ts";

type IdsEvent = EventDef<{ readonly ids: readonly string[] }>;

export interface SystemEventsDeps {
  readonly publishSystemEvent: (event: IdsEvent, ids: readonly string[]) => Promise<boolean>;
}

export function makeSystemEvents(d: SystemEventsDeps) {
  return async function publish(event: IdsEvent, actIds: readonly string[]): Promise<void> {
    if (actIds.length === 0) return;
    await d.publishSystemEvent(event, actIds);
  };
}

export type PublishSystemEvent = ReturnType<typeof makeSystemEvents>;
