// Таблица mail_messages (AUTH-06, ARCHITECTURE §6.1): локальный почтовый ящик — письма, пока SMTP не настроен.
// systemTable модуля mail: письмо адресовано email, а не домохозяйству, и читается только страницей ящика на
// локальном входе. Хранятся готовые поля письма (domain/message.ts), а не HTML: страница рисует их сама.
import { jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { systemTable } from "../../../../platform/db/tables.ts";
import type { MailNoteKind } from "../../domain/message.ts";

export const mailMessages = systemTable("mail_messages", {
  id: uuid()
    .primaryKey()
    .default(sql`uuidv7()`),
  recipient: text().notNull(),
  subject: text().notNull(),
  preview: text().notNull(),
  title: text().notNull(),
  paragraphs: jsonb().$type<readonly string[]>().notNull(),
  action: jsonb().$type<{ label: string; url: string }>(),
  note: jsonb().$type<{ kind: MailNoteKind; text: string }>(),
  sentAt: timestamp({ withTimezone: true }).notNull(),
});
