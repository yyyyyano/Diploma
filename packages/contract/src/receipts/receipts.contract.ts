// Чеки (RCPT-01…11, T-028): загрузка уже сделана процедурой files.upload (вид `receipt-photo`, до 10 файлов); здесь —
// «распознавать эти фото» (каждое — своя задача), вкладка чеков, карточка («Верно» / «Изменить» / «Отменить») и
// редактор позиций. Ход распознавания — сигналы events.stream по сущности `receipt`. Суммы — Money (копейки + валюта),
// статус и расхождения считает сервер (`validateReceipt`, P1); сайт ничего не считает.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { CategoryRef } from "../categories/categories.contract.ts";
import { LocalDate, Money } from "../common.ts";
import { pickErrors } from "../errors.ts";

export const ReceiptId = z.uuid().brand<"ReceiptId">();
export type ReceiptId = z.infer<typeof ReceiptId>;

/** До скольких фото за раз (RCPT-01): тот же предел, что у приёма файлов. */
export const MAX_RECEIPTS_PER_START = 10;

/** «Распознаётся» → «сходится» (зелёный бейдж) или «требует проверки» (охристый); «не вышло» — ошибка или дубль. */
export const ReceiptStatus = z.enum(["processing", "ok", "needs-review", "failed"]);
export type ReceiptStatus = z.infer<typeof ReceiptStatus>;

/** Этап пока чек «распознаётся» (RCPT-02, RCPT-06): «Читаю чек…», «Проверяю арифметику…», «Перепроверка строки 2…». */
export const ReceiptStage = z.enum(["reading", "checking", "rechecking"]);
export type ReceiptStage = z.infer<typeof ReceiptStage>;

/** Расхождение после перепроверок: что именно не сходится (строка с единицы или итог). Без наименований. */
export const ReceiptMismatch = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("line"),
    line: z.int().min(1),
    reason: z.enum(["arithmetic", "unreadable"]),
    expected: Money.schema.nullable(),
    printed: Money.schema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("total"),
    reason: z.enum(["arithmetic", "unreadable"]),
    expected: Money.schema.nullable(),
    printed: Money.schema.nullable(),
  }),
]);
export type ReceiptMismatch = z.infer<typeof ReceiptMismatch>;

export const ReceiptSummary = z.strictObject({
  id: ReceiptId,
  status: ReceiptStatus,
  stage: ReceiptStage.nullable(),
  /** Спорные строки с единицы (во время перепроверки — те, что перепроверяются). */
  disputedLines: z.array(z.int().min(1)),
  /** Код ошибки каталога, если «не вышло» (`RECEIPT_DUPLICATE`, `RECEIPT_UNREADABLE`…). */
  errorCode: z.string().nullable(),
  /** Дубль (RCPT-04): прежний чек и день его загрузки «12.10» — для «Этот чек уже загружен 12.10». */
  duplicateOf: z.strictObject({ id: ReceiptId, date: z.string() }).nullable(),
  storeName: z.string().nullable(),
  purchaseDate: LocalDate.schema.nullable(),
  purchaseTime: z.string().nullable(),
  total: Money.schema.nullable(),
  /** «Верно» нажато: чек подтверждён человеком. */
  confirmed: z.boolean(),
  /** Была перепроверка: в истории видно, что модель перечитывала строки (КП RCPT). */
  rechecks: z.int().min(0),
  createdAt: z.iso.datetime(),
});
export type ReceiptSummary = z.infer<typeof ReceiptSummary>;

export const ReceiptItem = z.strictObject({
  position: z.int().min(1),
  name: z.string(),
  normalizedName: z.string(),
  unit: z.string().nullable(),
  /** Количество в тысячных долях единицы: 3 шт → 3000, 0,345 кг → 345; не прочитано — null. */
  quantityMilli: z.int().nullable(),
  unitPrice: Money.schema.nullable(),
  discount: Money.schema,
  lineTotal: Money.schema.nullable(),
  disputed: z.boolean(),
  category: CategoryRef.nullable(),
  /** Позиция с гарантией (RCPT-13). */
  warranty: z.boolean(),
});
export type ReceiptItem = z.infer<typeof ReceiptItem>;

export const ReceiptAttempt = z.strictObject({
  attempt: z.int().min(0),
  askedLines: z.array(z.int().min(1)),
  changedLines: z.array(z.int().min(1)),
  ok: z.boolean(),
});

export const ReceiptCard = z.strictObject({
  receipt: ReceiptSummary,
  unp: z.string().nullable(),
  address: z.string().nullable(),
  payment: z
    .strictObject({ method: z.enum(["cash", "card"]), last4: z.string().nullable() })
    .nullable(),
  receiptDiscount: Money.schema,
  /** Нераспознанный остаток чека: уходит в «Прочее» (RCPT-07); 0 — сходится. */
  remainder: Money.schema,
  mismatches: z.array(ReceiptMismatch),
  items: z.array(ReceiptItem),
  /** История чтения и перепроверок (0 — первичное чтение). */
  attempts: z.array(ReceiptAttempt),
  /** Фото — `files.download` (RCPT-11). */
  fileId: z.uuid(),
  /** Операция чека (RCPT-10): `pending` — «ожидает выписки»; нет — чек не в BYN или «не вышло». */
  operation: z
    .strictObject({ id: z.uuid(), accountId: z.uuid(), pending: z.boolean(), merged: z.boolean() })
    .nullable(),
  /** «Проверить на сайте МНС» (RCPT-12): УИ и день копируются; сервис не запрашивается автоматически. */
  mns: z.strictObject({ uid: z.string(), date: LocalDate.schema.nullable() }).nullable(),
  /** `traceId` сверки итога для «Откуда эта цифра?» (EXPL-02). */
  traceId: z.uuid().nullable(),
});
export type ReceiptCard = z.infer<typeof ReceiptCard>;

/** Строка редактора позиций («Изменить»): числа — как исправил человек. */
export const ReceiptItemEdit = z.strictObject({
  name: z.string().trim().min(1).max(200),
  quantityMilli: z.int().min(1).max(1_000_000_000),
  unitPrice: Money.schema,
  discount: Money.schema,
  lineTotal: Money.schema,
});
export type ReceiptItemEdit = z.infer<typeof ReceiptItemEdit>;

export const ReceiptRef = z.strictObject({ id: ReceiptId });

export const receiptsContract = {
  /** Начать распознавание загруженных фото (`files.upload`, вид `receipt-photo`): до 10, каждое — своя задача; ответ сразу. */
  start: oc
    .route({ method: "POST", path: "/receipts" })
    .input(z.strictObject({ fileIds: z.array(z.uuid()).min(1).max(MAX_RECEIPTS_PER_START) }))
    .output(z.strictObject({ items: z.array(z.strictObject({ id: ReceiptId, fileId: z.uuid() })) }))
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND")),
  /** Вкладка чеков: новые сверху. */
  list: oc
    .route({ method: "GET", path: "/receipts" })
    .output(z.strictObject({ items: z.array(ReceiptSummary) }))
    .errors(pickErrors("UNAUTHORIZED")),
  /** Карточка чека: позиции, расхождения, история перепроверок, операция, данные для МНС. */
  get: oc
    .route({ method: "GET", path: "/receipts/{id}" })
    .input(ReceiptRef)
    .output(ReceiptCard)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND")),
  /** «Верно»: чек подтверждён, признак «требует проверки» у операции снят. */
  confirm: oc
    .route({ method: "POST", path: "/receipts/{id}/confirm" })
    .input(ReceiptRef)
    .output(ReceiptCard)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT")),
  /** «Изменить»: позиции целиком; сервер заново сверяет арифметику, обновляет статус, категории и операцию. */
  updateItems: oc
    .route({ method: "PUT", path: "/receipts/{id}/items" })
    .input(
      z.strictObject({
        id: ReceiptId,
        items: z.array(ReceiptItemEdit).min(1).max(200),
        total: Money.schema,
        receiptDiscount: Money.schema,
      }),
    )
    .output(ReceiptCard)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT")),
  /** «Отменить»: чек, его операция и фото удаляются (остаток «Наличных» возвращается). */
  cancel: oc
    .route({ method: "POST", path: "/receipts/{id}/cancel" })
    .input(ReceiptRef)
    .output(z.strictObject({ id: ReceiptId }))
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT")),
};
