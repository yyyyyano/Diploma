// Публикация событий (ADR-0004, ADR-0008, ARCHITECTURE §5): events.publish(tx, событие, нагрузка) ставит задачу
// каждой подписке в той же транзакции, что и запись данных (через jobs.enqueue): нет записи — нет события, нет
// события — нет записи. Публикующий модуль не знает слушателей; нет подписок — ничего не ставится.
import type { ScopedDb } from "../db/scoped-db.ts";
import type { Jobs } from "../jobs/jobs.ts";
import { MAX_EVENT_IDS, type EventDef, type EventPayload } from "./define-event.ts";
import type { SubscriptionDef } from "./define-subscription.ts";

export interface Events {
  /** Опубликовать внутри транзакции записи данных; нагрузка не по схеме или больше MAX_EVENT_IDS id — ошибка. */
  publish<P extends EventPayload>(tx: ScopedDb, event: EventDef<P>, payload: P): Promise<void>;
}

export interface EventsDeps {
  readonly jobs: Jobs;
  /** Все подписки процесса (реестр — T-007); их задачи регистрирует jobs.start. */
  readonly subscriptions: readonly SubscriptionDef[];
}

export function createEvents(deps: EventsDeps): Events {
  const byEvent = new Map<string, SubscriptionDef[]>();
  for (const subscription of deps.subscriptions) {
    const list = byEvent.get(subscription.event.name) ?? [];
    if (list.some((known) => known.module === subscription.module)) {
      throw new Error(
        `Модуль ${subscription.module} подписан на ${subscription.event.name} дважды.`,
      );
    }
    byEvent.set(subscription.event.name, [...list, subscription]);
  }
  return {
    async publish(tx, event, payload) {
      const parsed = event.payload.safeParse(payload);
      if (!parsed.success) {
        // Нагрузку собирает код: несовпадение — ошибка программы; значений в тексте нет (OBS-04).
        throw new RangeError(
          `Нагрузка события ${event.name} не по схеме (пачка — от 1 до ${MAX_EVENT_IDS} id).`,
        );
      }
      for (const subscription of byEvent.get(event.name) ?? []) {
        await deps.jobs.enqueue(tx, subscription.job, parsed.data);
      }
    },
  };
}
