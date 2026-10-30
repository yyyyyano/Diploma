// Таблицы receipts (RCPT-03…07, ARCHITECTURE §6.1) — userOwnedTable. receipts: чек, его распознавание и итог проверки;
// receipt_items: позиции с нормализованным наименованием (RCPT-15); receipt_attempts: история проверок — первичное чтение
// и перепроверки (RCPT-06: «была перепроверка»). УИ уникален в домохозяйстве (RCPT-04). Тексты распознавания (сырой
// ответ модели) не хранятся: только разобранные поля чека и расхождения без наименований.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ownedFk, userOwnedTable } from "../../../../platform/db/tables.ts";
import type { Mismatch, PaymentMethod, ReceiptStage, ReceiptStatus } from "../../domain/types.ts";

export const receipts = userOwnedTable(
  "receipts",
  {
    /** Исходное фото в `files` (RCPT-11). */
    fileId: uuid().notNull(),
    status: text().$type<ReceiptStatus>().notNull(),
    /** Этап, пока чек «распознаётся»; потом null. */
    stage: text().$type<ReceiptStage>(),
    /** Название магазина как прочитано; ключ очистки — для поиска дубля без QR (RCPT-04). */
    storeName: text(),
    storeKey: text(),
    /** Контрагент справочника, если узнан. */
    merchantId: uuid(),
    unp: text(),
    address: text(),
    purchaseDate: date({ mode: "string" }),
    /** Время «чч:мм:сс»; не прочитано — null. */
    purchaseTime: text(),
    currency: text().notNull().default("BYN"),
    totalMinor: bigint({ mode: "number" }),
    /** Скидки на весь чек, копейки (не меньше нуля). */
    receiptDiscountMinor: bigint({ mode: "number" }).notNull().default(0),
    paymentMethod: text().$type<PaymentMethod>(),
    cardLast4: text(),
    /** УИ из QR (RCPT-04): уникален в домохозяйстве; нет QR — null. */
    uid: text(),
    /** Спорные строки с единицы и расхождения, оставшиеся после перепроверок (RCPT-07). */
    disputedLines: integer()
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    mismatches: jsonb()
      .$type<readonly Mismatch[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Итог минус (сумма строк − скидки): «нераспознанный остаток чека» → «Прочее» (RCPT-07); сходится — 0. */
    remainderMinor: bigint({ mode: "number" }).notNull().default(0),
    /** Сколько перепроверок было. */
    rechecks: integer().notNull().default(0),
    /** Сохранённая трасса сверки итога для «Откуда эта цифра?» (EXPL-02). */
    traceId: uuid(),
    /** Версия подсказки, которой читали чек (ключ кассет и eval). */
    promptVersion: text(),
    /** Код ошибки каталога, если чек не распознан, и дубль: чек, на который он похож. */
    errorCode: text(),
    duplicateOf: uuid(),
    recognizedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      "receipts_status_check",
      sql`${t.status} in ('processing', 'ok', 'needs-review', 'failed')`,
    ),
    check("receipts_payment_check", sql`${t.paymentMethod} in ('cash', 'card')`),
    check("receipts_discount_check", sql`${t.receiptDiscountMinor} >= 0`),
    // RCPT-04: тот же чек (УИ) во второй раз не создаётся; NULL уникальным не считается.
    uniqueIndex("receipts_uid_idx").on(t.householdId, t.uid),
    index("receipts_status_idx").on(t.householdId, t.status, t.createdAt),
    index("receipts_dedupe_idx").on(t.householdId, t.storeKey, t.purchaseDate, t.totalMinor),
  ],
);

export const receiptItems = userOwnedTable(
  "receipt_items",
  {
    receiptId: uuid().notNull(),
    /** Номер строки на чеке с единицы. */
    position: integer().notNull(),
    name: text().notNull(),
    /** RCPT-15: без веса, объёма и жирности — задел динамики цен (DIP-07). */
    normalizedName: text().notNull(),
    unit: text(),
    /** Количество в тысячных долях единицы; не прочитано — null. */
    quantityMilli: bigint({ mode: "number" }),
    unitPriceMinor: bigint({ mode: "number" }),
    discountMinor: bigint({ mode: "number" }).notNull().default(0),
    lineTotalMinor: bigint({ mode: "number" }),
    /** Строка осталась спорной после перепроверок. */
    disputed: boolean().notNull().default(false),
  },
  (t) => [
    check("receipt_items_position_check", sql`${t.position} >= 1`),
    uniqueIndex("receipt_items_position_idx").on(t.householdId, t.receiptId, t.position),
    ...ownedFk(t, t.receiptId, receipts, { onDelete: "cascade" }),
  ],
);

export const receiptAttempts = userOwnedTable(
  "receipt_attempts",
  {
    receiptId: uuid().notNull(),
    /** 0 — первичное чтение, 1… — перепроверки (RCPT-06). */
    attempt: integer().notNull(),
    /** Какие строки перепроверяли (пусто у первичного чтения). */
    askedLines: integer()
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    /** Строки, значения которых изменились после этой попытки. */
    changedLines: integer()
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    /** Сошлось ли всё после этой попытки и что осталось спорным (без наименований). */
    ok: boolean().notNull(),
    mismatches: jsonb()
      .$type<readonly Mismatch[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => [
    check("receipt_attempts_attempt_check", sql`${t.attempt} >= 0`),
    uniqueIndex("receipt_attempts_attempt_idx").on(t.householdId, t.receiptId, t.attempt),
    ...ownedFk(t, t.receiptId, receipts, { onDelete: "cascade" }),
  ],
);
