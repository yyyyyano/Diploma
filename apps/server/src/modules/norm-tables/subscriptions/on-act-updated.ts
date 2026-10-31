// legal-base.act-updated → сверка таблицы ставок с новой редакцией (LAW-33). Идемпотентна: перечитывает состояние и ставит те же
// пометки; повторная доставка события безопасна, уведомление — по ключу «ставка + версии фрагментов».
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { actUpdated } from "../../legal-base/index.ts";
import type { DriftCheck } from "../application/drift-check.ts";

export function onActUpdated(check: DriftCheck) {
  return defineSubscription({
    event: actUpdated,
    module: "norm-tables",
    handle: async () => {
      await check();
    },
  });
}
