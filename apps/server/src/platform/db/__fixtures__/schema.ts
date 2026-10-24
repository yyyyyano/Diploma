// Тестовая схема механизма изоляции (не боевая): чек, его позиции, операция со ссылкой на чек, системная и
// общая таблицы. Префикс fx_ — чтобы не столкнуться с таблицами модулей в одной тестовой базе.
// Миграции — рядом, в drizzle/ (make db-generate DRIZZLE_CONFIG=…/__fixtures__/drizzle.config.ts);
// в apps/server/drizzle они не попадают.
import { bigint, text, uuid } from "drizzle-orm/pg-core";
import { ownedFk, publicTable, systemTable, userOwnedTable } from "../tables.ts";

export const fxReceipts = userOwnedTable("fx_receipts", {
  merchant: text().notNull(),
  totalMinor: bigint({ mode: "number" }).notNull(),
  status: text().notNull().default("recognizing"),
  note: text(),
});

export const fxReceiptItems = userOwnedTable(
  "fx_receipt_items",
  {
    receiptId: uuid().notNull(),
    name: text().notNull(),
    sumMinor: bigint({ mode: "number" }).notNull(),
  },
  (t) => [...ownedFk(t, t.receiptId, fxReceipts, { onDelete: "cascade" })],
);

export const fxTransactions = userOwnedTable(
  "fx_transactions",
  {
    description: text().notNull(),
    amountMinor: bigint({ mode: "number" }).notNull(),
    // Ссылка необязательна: удаление чека обнуляет её, не трогая household_id (SET NULL (receipt_id)).
    receiptId: uuid(),
  },
  (t) => [...ownedFk(t, t.receiptId, fxReceipts, { onDelete: "set null" })],
);

export const fxSettings = systemTable("fx_settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});

export const fxRates = publicTable("fx_rates", {
  code: text().primaryKey(),
  rateMicros: bigint({ mode: "number" }).notNull(),
});
