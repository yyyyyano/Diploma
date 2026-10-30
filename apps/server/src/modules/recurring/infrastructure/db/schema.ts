// Таблицы recurring (REC-01…05, ARCHITECTURE §6.1) — userOwnedTable. Платёж: контрагент и направление (доход / расход),
// раздел экрана, период, состояние (active | suggested | maybe-ended | ended | excluded), день месяца, основание средней
// суммы — последние повторы с суммами в BYN (`occurrences`) и id всех операций серии (`member_ids`: по ним «Операции»
// помечают регулярные строки). Что человек поправил (`user_fixed`: section, period, day, amount), следующий поиск не
// перетирает. `series_key` — стабильная личность серии («направление|контрагент|день при создании»): аванс и зарплата
// одного нанимателя — две строки, параллельный поиск не создаёт дубль (уникальный индекс). Исключённое остаётся строкой
// состояния `excluded` — по ней поиск знает, что «это не регулярный». Деньги — целые копейки BYN (bigint).
// Ревизия — человеческие поля до действия: по ней «Отменить» возвращает платёж, в журнале — только её id.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  integer,
  jsonb,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ownedFk, userOwnedTable } from "../../../../platform/db/tables.ts";

export const recurringItems = userOwnedTable(
  "recurring_items",
  {
    seriesKey: text().notNull(),
    /** Ключ очистки названия контрагента (merchants); у добавленного вручную — null. */
    merchantKey: text(),
    name: text().notNull(),
    flow: text().notNull(),
    section: text().notNull(),
    period: text().notNull(),
    state: text().notNull(),
    source: text().notNull().default("detected"),
    /** День месяца серии (медиана дат повторов); у еженедельных — null. */
    anchorDay: integer(),
    /** Сумма, которую назвал человек (исправить, добавить вручную): перекрывает среднюю по операциям. */
    manualAmountMinor: bigint({ mode: "number" }),
    /** Повторы-основания: [{ id, on, minor }] по возрастанию даты, ≤ окна; сумма — эквивалент в BYN. */
    occurrences: jsonb()
      .notNull()
      .default(sql`'[]'::jsonb`),
    memberIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    lastOccurredOn: date({ mode: "string" }),
    nextExpectedOn: date({ mode: "string" }).notNull(),
    /** «Ещё придёт»: на эту ожидаемую дату «возможно прекращён» больше не ставится (REC-05). */
    ackExpectedOn: date({ mode: "string" }),
    categoryCode: text(),
    categoryId: uuid(),
    /** Поля, поправленные человеком: поиск их не перетирает. */
    userFixed: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    check("recurring_items_flow_check", sql`${t.flow} in ('income', 'expense')`),
    check(
      "recurring_items_section_check",
      sql`${t.section} in ('income', 'mandatory', 'subscriptions', 'other')`,
    ),
    check("recurring_items_period_check", sql`${t.period} in ('week', 'month', 'quarter', 'year')`),
    check(
      "recurring_items_state_check",
      sql`${t.state} in ('active', 'suggested', 'maybe-ended', 'ended', 'excluded')`,
    ),
    check("recurring_items_source_check", sql`${t.source} in ('detected', 'manual')`),
    check(
      "recurring_items_day_check",
      sql`${t.anchorDay} is null or ${t.anchorDay} between 1 and 31`,
    ),
    uniqueIndex("recurring_items_series_idx").on(t.householdId, t.userId, t.seriesKey),
  ],
);

export const recurringRevisions = userOwnedTable(
  "recurring_revisions",
  {
    itemId: uuid().notNull(),
    /** Платежа до действия не было (добавлен вручную): «Отменить» его убирает. */
    existed: boolean().notNull(),
    section: text().notNull(),
    period: text().notNull(),
    state: text().notNull(),
    anchorDay: integer(),
    manualAmountMinor: bigint({ mode: "number" }),
    nextExpectedOn: date({ mode: "string" }).notNull(),
    ackExpectedOn: date({ mode: "string" }),
    userFixed: text().array().notNull(),
  },
  (t) => [...ownedFk(t, t.itemId, recurringItems, { onDelete: "cascade" })],
);
