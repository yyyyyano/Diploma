// Процедуры receipts (contract.receipts.*): тонко — authed (домохозяйство из сессии) → сценарий. Фото уже загружено
// процедурой files.upload (вид `receipt-photo`); здесь — распознавание, вкладка, карточка, «Верно» / «Изменить» / «Отменить».
import { ReceiptId } from "@kosht/contract";
import { FileId } from "@kosht/kernel";
import { authed } from "../../../platform/http/procedures.ts";
import type { Recognize } from "../application/recognize.ts";
import type { Review } from "../application/review.ts";

export function receiptsRouter(recognize: Recognize, review: Review) {
  return {
    start: authed.receipts.start.handler(async ({ input, context }) => {
      // Каждое фото — своя задача (RCPT-01); недоступный файл (чужой, не «фото чека») — ошибка до первой постановки.
      const items: { id: ReceiptId; fileId: string }[] = [];
      for (const fileId of input.fileIds) {
        const { id } = await recognize.start(context.s, FileId.parse(fileId));
        items.push({ id: ReceiptId.parse(id), fileId });
      }
      return { items };
    }),
    list: authed.receipts.list.handler(async ({ context }) => ({
      items: await review.list(context.s),
    })),
    get: authed.receipts.get.handler(({ input, context }) => review.get(context.s, input.id)),
    confirm: authed.receipts.confirm.handler(({ input, context }) =>
      review.confirm(context.s, input.id),
    ),
    updateItems: authed.receipts.updateItems.handler(({ input, context }) =>
      review.updateItems(context.s, input.id, input),
    ),
    cancel: authed.receipts.cancel.handler(async ({ input, context }) => {
      await review.cancel(context.s, input.id);
      return { id: input.id };
    }),
  };
}
