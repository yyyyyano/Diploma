// Публикация системных событий общей базы (законы): scope — первого администратора (identity.adminScoped), транзакция — одна на
// событие. Администратора ещё нет — событие не публикуется (системы нет, подписчикам нечего пересчитывать).
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { EventDef } from "../../../platform/events/define-event.ts";
import type { Events } from "../../../platform/events/events.ts";

export interface SystemEventsDeps {
  readonly adminScoped: () => Promise<ScopedDb | undefined>;
  readonly events: Pick<Events, "publish">;
}

export function makeSystemEvents(d: SystemEventsDeps) {
  return async function publish(
    event: EventDef<{ readonly ids: readonly string[] }>,
    actIds: readonly string[],
  ): Promise<void> {
    if (actIds.length === 0) return;
    const s = await d.adminScoped();
    if (s === undefined) return;
    await s.transaction((tx) => d.events.publish(tx, event, { ids: [...actIds] }));
  };
}

export type PublishSystemEvent = ReturnType<typeof makeSystemEvents>;
