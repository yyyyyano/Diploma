// receipts.warranty-items-found → события «конец гарантии» (CAL-04, RCPT-13). Нагрузке — только id чеков: позиции, магазин и день
// покупки читаются заново. Событие на позицию одно (ключ), повтор доставки дубль не создаёт.
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { receiptsWarrantyItemsFound } from "../../receipts/index.ts";

export function onWarrantyItemsFound(
  sync: (s: ScopedDb, receiptIds: readonly string[]) => Promise<number>,
) {
  return defineSubscription({
    event: receiptsWarrantyItemsFound,
    module: "calendar",
    handle: async (ctx, payload) => {
      await sync(ctx.s, payload.ids);
    },
  });
}
