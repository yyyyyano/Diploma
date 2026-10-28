// privacy.export-ready → уведомление «Архив «Мои данные» готов» (PRIV-05, NOTIF-02). Нагрузке не верим: готовность
// каждой заявки перечитывается фасадом privacy через ctx.s (чужая заявка для s не готова — её нет). Повтор доставки
// не дублирует уведомление: notify идемпотентен по виду и ключу (id заявки).
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { exportReady, type PrivacyFacade } from "../../privacy/index.ts";
import type { makeNotify } from "../application/notify.ts";

export function onExportReady(
  privacy: Pick<PrivacyFacade, "isExportReady">,
  notify: ReturnType<typeof makeNotify>,
) {
  return defineSubscription({
    event: exportReady,
    module: "notifications",
    handle: async (ctx, payload) => {
      for (const id of payload.ids) {
        if (!(await privacy.isExportReady(ctx.s, id))) continue;
        await notify(ctx.s, {
          kind: "data-export-ready",
          key: id,
          objectRef: { entity: "data-export", id },
        });
      }
    },
  });
}
