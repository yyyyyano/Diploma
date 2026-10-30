// Таблицы transactions (TXN-01…05, STMT-09, CAT-03, ARCHITECTURE §6.1) — userOwnedTable.
// Операция: счёт, тип (доход / расход / перевод / возврат) и направление движения денег по счёту, день и время (если
// известно), сумма в валюте операции (целые копейки), эквивалент в BYN по курсу НБРБ на день операции и id курса (нет
// курса — null: «курс не получен», досчитывает фоновая задача), исходное описание, контрагент (как показывать и ключ
// очистки — по нему правило CAT-05), категория (встроенная по коду или своя по id; у перевода нет) и её источник,
// источник операции, видимость (`personal` по умолчанию, DIP-03), пара перевода и исходная покупка возврата, версия —
// растёт с каждой правкой: «Отменить» сверяет её и не затирает более позднюю правку.
//
// Составные FK на чужие таблицы (accounts, categories, system_categories) и на себя (пара, покупка) Drizzle-схема
// объявить не может — чужая схема недоступна модулю (schema-only-in-infrastructure); они написаны руками в миграции
// *_transactions: счёт и своя категория — RESTRICT (счёт с операциями не удаляется, STMT-01), пара и покупка —
// SET NULL (колонка).
//
// Ревизия — история изменений (TXN-05) и материал «Отменить»: одно действие = одна пачка (batch_id) ревизий, у каждой —
// что сделано, канал, состояние операции до действия (before) и версия после. FK на операцию нет намеренно: история и
// снимок удалённой операции переживают её удаление — по ним «Отменить» возвращает удалённое.
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
  time,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ownedFk, userOwnedTable } from "../../../../platform/db/tables.ts";

export const transactions = userOwnedTable(
  "transactions",
  {
    accountId: uuid().notNull(),
    type: text().notNull(),
    /** in — деньги пришли на счёт, out — ушли; у дохода и возврата in, у расхода out, у перевода — по смыслу. */
    direction: text().notNull(),
    occurredOn: date({ mode: "string" }).notNull(),
    occurredTime: time({ precision: 0 }),
    amountMinor: bigint({ mode: "number" }).notNull(),
    currency: text().notNull(),
    /** STMT-09: эквивалент в BYN; null — курс НБРБ ещё не получен. */
    amountBynMinor: bigint({ mode: "number" }),
    /** Курс НБРБ (currency_rates.id), по которому посчитан эквивалент; BYN — null. */
    fxRateId: uuid(),
    description: text().notNull().default(""),
    merchantName: text(),
    /** Ключ очищенного описания контрагента (merchants) — правило CAT-05 и «применить к прошлым». */
    merchantKey: text(),
    note: text(),
    categoryCode: text(),
    categoryId: uuid(),
    categorySource: text(),
    source: text().notNull(),
    visibility: text().notNull().default("personal"),
    transferPairId: uuid(),
    refundOfId: uuid(),
    /** Импорт выписки, из которого операция (STMT-11, откат целиком); у ручных и чековых — null. Без FK: импорт — в statements. */
    importId: uuid(),
    /** Банковский идентификатор операции в пределах счёта «счёт|номер» (STMT-07); нет у выписки — null. */
    externalId: text(),
    /** Ключ дубля STMT-07: счёт, день, время, сумма, описание и порядковый номер среди одинаковых; у выписки. */
    dedupeKey: text(),
    /** Чек, из которого операция (RCPT-08, RCPT-10, TXN-10); у остальных — null. Без FK: чек — в receipts. */
    receiptId: uuid(),
    /** «Ожидает выписки» (RCPT-10): предварительная операция от чека по карте — в тратах учитывается, остаток счёта не меняет. */
    pending: boolean().notNull().default(false),
    /** Чек операции «требует проверки» (TXN-01): признак в списке и фильтр. */
    needsReview: boolean().notNull().default(false),
    version: integer().notNull().default(1),
  },
  (t) => [
    check("transactions_type_check", sql`${t.type} in ('expense', 'income', 'transfer', 'refund')`),
    check(
      "transactions_direction_check",
      sql`${t.direction} in ('in', 'out') and (${t.type} = 'transfer' or ${t.direction} = case ${t.type} when 'expense' then 'out' else 'in' end)`,
    ),
    check("transactions_amount_check", sql`${t.amountMinor} > 0`),
    check("transactions_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "transactions_category_check",
      sql`case when ${t.type} = 'transfer' then num_nonnulls(${t.categoryCode}, ${t.categoryId}) = 0 else num_nonnulls(${t.categoryCode}, ${t.categoryId}) = 1 and ${t.categorySource} is not null end`,
    ),
    check(
      "transactions_category_source_check",
      sql`${t.categorySource} is null or ${t.categorySource} in ('user', 'user-rule', 'merchant', 'keyword', 'mcc', 'model', 'cache', 'fallback')`,
    ),
    check(
      "transactions_source_check",
      sql`${t.source} in ('manual', 'assistant', 'statement', 'receipt')`,
    ),
    check("transactions_visibility_check", sql`${t.visibility} in ('personal', 'shared')`),
    // TXN-02: страница по дате (последний ключ — id), поиск по счёту и по контрагенту (CAT-05).
    index("transactions_date_idx").on(t.householdId, t.occurredOn.desc(), t.id.desc()),
    index("transactions_merchant_key_idx").on(t.householdId, t.merchantKey),
    // STMT-07, STMT-11: проверка дублей по ключу и идентификатору, операции одного импорта.
    index("transactions_dedupe_idx")
      .on(t.householdId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index("transactions_external_idx")
      .on(t.householdId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index("transactions_import_idx")
      .on(t.householdId, t.importId)
      .where(sql`${t.importId} is not null`),
    index("transactions_receipt_idx")
      .on(t.householdId, t.receiptId)
      .where(sql`${t.receiptId} is not null`),
    index("transactions_rate_missing_idx")
      .on(t.householdId, t.id)
      .where(sql`${t.amountBynMinor} is null`),
  ],
);

export const transactionRevisions = userOwnedTable(
  "transaction_revisions",
  {
    transactionId: uuid().notNull(),
    /** Одно действие — одна пачка: «Отменить» возвращает всю пачку. */
    batchId: uuid().notNull(),
    action: text().notNull(),
    channel: text().notNull(),
    /** Состояние операции до действия (у созданной — null). */
    before: jsonb(),
    /** Версия операции после действия (у удалённой — null). */
    versionAfter: integer(),
    /** Что изменилось — имена полей для истории в карточке. */
    fields: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    check(
      "transaction_revisions_action_check",
      sql`${t.action} in ('created', 'updated', 'deleted', 'restored')`,
    ),
    check(
      "transaction_revisions_channel_check",
      sql`${t.channel} in ('web', 'telegram', 'system')`,
    ),
    index("transaction_revisions_transaction_idx").on(t.householdId, t.transactionId, t.createdAt),
    index("transaction_revisions_batch_idx").on(t.householdId, t.batchId),
  ],
);

/**
 * Разбивка операции по категориям (RCPT-09, TXN-10): у операции от чека — сумма по категориям позиций, у слитой с
 * выпиской — разбивка из чека. Агрегации (T-031) распределяют траты по ней, а не по категории операции. Сумма частей
 * равна сумме операции. FK на категории — руками в миграции (чужая схема недоступна), как у transactions.
 */
export const transactionSplits = userOwnedTable(
  "transaction_splits",
  {
    transactionId: uuid().notNull(),
    position: integer().notNull(),
    categoryCode: text(),
    categoryId: uuid(),
    amountMinor: bigint({ mode: "number" }).notNull(),
  },
  (t) => [
    check("transaction_splits_amount_check", sql`${t.amountMinor} > 0`),
    check(
      "transaction_splits_category_check",
      sql`num_nonnulls(${t.categoryCode}, ${t.categoryId}) = 1`,
    ),
    uniqueIndex("transaction_splits_position_idx").on(t.householdId, t.transactionId, t.position),
    ...ownedFk(t, t.transactionId, transactions, { onDelete: "cascade" }),
  ],
);
