// События receipts (ADR-0004, ARCHITECTURE §5): нагрузка — id чеков, без сумм и текстов (OBS-04). Подписчики перечитывают
// состояние сами.
import { z } from "zod";
import { defineEvent } from "../../platform/events/define-event.ts";

/** Чек распознан: сходится или требует проверки — позиции и итог сохранены (RCPT-07). */
export const receiptsRecognized = defineEvent({
  name: "receipts.recognized",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});

/** После перепроверок расхождение осталось: чек сохранён, спорные строки названы (RCPT-07). */
export const receiptsNeedsReview = defineEvent({
  name: "receipts.needs-review",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});

/** В чеке есть позиции с гарантией (RCPT-13): календарь создаёт «конец гарантии» (CAL-04). */
export const receiptsWarrantyItemsFound = defineEvent({
  name: "receipts.warranty-items-found",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});
