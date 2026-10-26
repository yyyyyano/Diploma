// Запросы к локальному ящику (systemTable mail_messages) — только через SystemDb модуля mail.
import { desc } from "drizzle-orm";
import type { SystemDb } from "../../../../platform/db/system-db.ts";
import type { MailMessage, StoredMail } from "../../domain/message.ts";
import { mailMessages } from "./schema.ts";

/** Сколько последних писем показывает ящик. */
export const MAILBOX_LIMIT = 100;

export async function insertMail(db: SystemDb, message: MailMessage, at: Date): Promise<void> {
  await db.insert(mailMessages).values({
    recipient: message.to,
    subject: message.subject,
    preview: message.preview,
    title: message.title,
    paragraphs: message.paragraphs,
    action: message.action ?? null,
    note: message.note ?? null,
    sentAt: at,
  });
}

/** Последние письма, новые сверху (при равном времени — по id uuidv7). */
export async function listMail(db: SystemDb): Promise<StoredMail[]> {
  const rows = await db
    .select()
    .from(mailMessages)
    .orderBy(desc(mailMessages.sentAt), desc(mailMessages.id))
    .limit(MAILBOX_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    to: row.recipient,
    subject: row.subject,
    preview: row.preview,
    title: row.title,
    paragraphs: row.paragraphs,
    ...(row.action === null ? {} : { action: row.action }),
    ...(row.note === null ? {} : { note: row.note }),
    sentAt: row.sentAt,
  }));
}
