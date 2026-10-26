// Таблицы actions (P5, AGT-05, AGT-07, ARCHITECTURE §5) — userOwnedTable: журнал отменяемых действий и ожидающие
// решения «Да/Нет». В нагрузке — только id объектов (обработчик модуля-владельца перечитывает состояние сам).
import { sql } from "drizzle-orm";
import { check, index, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { userOwnedTable } from "../../../../platform/db/tables.ts";

/**
 * Журнал отменяемых действий: обработчик отмены (`<модуль>.<действие>`), нагрузка, объект (`<вид>:<id>` — для
 * проверки «после этого действия объект уже правили»), канал и состояние done → undone.
 */
export const actionJournal = userOwnedTable(
  "action_journal",
  {
    handler: text().notNull(),
    payload: jsonb().notNull(),
    subject: text().notNull(),
    channel: text().notNull(),
    status: text().notNull().default("done"),
    undoneAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("action_journal_status_check", sql`${t.status} in ('done', 'undone')`),
    check("action_journal_channel_check", sql`${t.channel} in ('web', 'telegram')`),
    index("action_journal_subject_idx").on(t.householdId, t.subject, t.createdAt),
  ],
);

/**
 * Ожидающее решение «Да/Нет»: обработчик ответа «Да», нагрузка, описание изменений для человека (ключ словаря и
 * параметры), состояние pending → yes | no, канал и момент ответа.
 */
export const pendingDecisions = userOwnedTable(
  "pending_decisions",
  {
    handler: text().notNull(),
    payload: jsonb().notNull(),
    summary: jsonb().$type<{ key: string; params: Record<string, string | number> }>().notNull(),
    status: text().notNull().default("pending"),
    channel: text(),
    answeredAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("pending_decisions_status_check", sql`${t.status} in ('pending', 'yes', 'no')`),
    check(
      "pending_decisions_channel_check",
      sql`${t.channel} is null or ${t.channel} in ('web', 'telegram')`,
    ),
  ],
);
