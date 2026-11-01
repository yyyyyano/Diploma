// receipts.recognized и receipts.needs-review → карточка чека в чат бота (TG-03): подписка воркера. В нагрузке — только id
// чеков; чек, присланный не из бота, строки `telegram_receipt_cards` не имеет — ему карточки в Telegram нет. Бот не настроен
// (токена нет) — тихо пропускаем: карточка останется на сайте.
import { defineSubscription } from "../../../platform/events/define-subscription.ts";
import { receiptsNeedsReview, receiptsRecognized } from "../../receipts/index.ts";
import type { Sender } from "../application/ports.ts";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";

export interface ReceiptReadyDeps {
  readonly sender: () => Promise<Sender | undefined>;
  readonly deliver: (s: ScopedDb, receiptId: string, api: Sender) => Promise<boolean>;
}

export function onReceiptReady(d: ReceiptReadyDeps) {
  const handle = async (
    ctx: { readonly s: ScopedDb },
    payload: { readonly ids: readonly string[] },
  ) => {
    const sender = await d.sender();
    if (sender === undefined) return;
    for (const id of payload.ids) await d.deliver(ctx.s, id, sender);
  };
  return [
    defineSubscription({ event: receiptsRecognized, module: "telegram", handle }),
    defineSubscription({ event: receiptsNeedsReview, module: "telegram", handle }),
  ];
}
