// Таблицы telegram (TG-02, TG-03, ARCHITECTURE §6.4): всё — systemTable, без household_id как владельца строки: привязка
// «чат → пользователь» нужна до того, как известен scope, поэтому доступ — через SystemDb. Тексты переписки и содержимое чеков
// здесь не хранятся.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { systemTable } from "../../../../platform/db/tables.ts";

/** Привязка: один аккаунт — один чат (первичный ключ — пользователь), один чат — один аккаунт (уникальный `chat_id`). */
export const telegramLinks = systemTable(
  "telegram_links",
  {
    userId: uuid().primaryKey(),
    householdId: uuid().notNull(),
    /** id личного чата (равен id пользователя Telegram); число Telegram — до 2^52, в bigint как number. */
    chatId: bigint({ mode: "number" }).notNull(),
    /** Имя в Telegram (`@имя`) — только для строки «Telegram: подключён» на сайте. */
    username: text(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("telegram_links_chat_id_idx").on(t.chatId)],
);

/**
 * Одноразовые коды привязки (TG-02): хранится хэш SHA-256 (код ≥ 128 бит, из ссылки на бота), срок и отметка использования.
 * Строки старше срока удаляются при выдаче нового кода того же пользователя.
 */
export const telegramLinkCodes = systemTable(
  "telegram_link_codes",
  {
    codeHash: text().primaryKey(),
    userId: uuid().notNull(),
    householdId: uuid().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index("telegram_link_codes_user_idx").on(t.userId)],
);

/** Чек, присланный фото из бота: в какой чат отправить карточку, когда чек распознан (один раз — `delivered_at`). */
export const telegramReceiptCards = systemTable(
  "telegram_receipt_cards",
  {
    receiptId: uuid().primaryKey(),
    householdId: uuid().notNull(),
    chatId: bigint({ mode: "number" }).notNull(),
    deliveredAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index("telegram_receipt_cards_household_idx").on(t.householdId)],
);

/** Имя бота из `getMe` — одна строка, её пишет процесс `bot`: кнопка «Подключить Telegram» строит ссылку по ней. */
export const telegramBot = systemTable(
  "telegram_bot",
  {
    id: smallint().primaryKey().default(1),
    username: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [check("telegram_bot_single_row_check", sql`${t.id} = 1`)],
);
