// Канал «сайт» (NOTIF-01): уведомление попадает в ленту колокольчика, а сигнал realtime.changed (через s: в
// транзакции — при коммите) обновляет колокольчик без перезагрузки.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { DeliveryChannel, Platform } from "../../../platform/module/define-module.ts";
import { markShownOnWeb } from "../infrastructure/db/notifications.repo.ts";

export function webChannel(d: Pick<Platform, "realtime">): DeliveryChannel {
  return {
    name: "web",
    async deliver(s: ScopedDb, ids) {
      await markShownOnWeb(s, ids);
      await d.realtime.changed(s, { entity: "notification", ids });
    },
  };
}
