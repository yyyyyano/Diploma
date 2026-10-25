// Запросы к таблицам chat: первый аргумент — s: ScopedDb, у каждого обращения свой s.own (ADR-0006).
import { and, asc, desc, eq } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { chatConversations, chatMessages } from "./schema.ts";

export type MessageRole = "user" | "assistant";
export type MessageStatus = "streaming" | "complete" | "interrupted";

export interface MessageRow {
  readonly id: string;
  readonly role: string;
  readonly parts: unknown;
  readonly status: string;
}

export async function createConversation(s: ScopedDb): Promise<string> {
  const [row] = await s
    .insert(chatConversations)
    .values({})
    .returning({ id: chatConversations.id });
  if (row === undefined) throw new Error("Диалог не создан.");
  return row.id;
}

/** Диалог своего домохозяйства есть (чужой id неотличим от несуществующего). */
export async function conversationExists(s: ScopedDb, id: string): Promise<boolean> {
  const rows = await s.db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(and(s.own(chatConversations), eq(chatConversations.id, id)));
  return rows.length === 1;
}

/** Последний диалог домохозяйства или undefined. */
export async function latestConversation(s: ScopedDb): Promise<string | undefined> {
  const rows = await s.db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(s.own(chatConversations))
    .orderBy(desc(chatConversations.createdAt), desc(chatConversations.id))
    .limit(1);
  return rows[0]?.id;
}

export async function insertMessage(
  s: ScopedDb,
  message: {
    readonly conversationId: string;
    readonly role: MessageRole;
    readonly parts: unknown;
    readonly status: MessageStatus;
  },
): Promise<string> {
  const [row] = await s.insert(chatMessages).values(message).returning({ id: chatMessages.id });
  if (row === undefined) throw new Error("Сообщение не сохранено.");
  return row.id;
}

/** Сообщения диалога по порядку. */
export async function listMessages(s: ScopedDb, conversationId: string): Promise<MessageRow[]> {
  return s.db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      parts: chatMessages.parts,
      status: chatMessages.status,
    })
    .from(chatMessages)
    .where(and(s.own(chatMessages), eq(chatMessages.conversationId, conversationId)))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
}

/** Ответ ассистента дописан: части сообщения и итоговое состояние. */
export async function finishMessage(
  s: ScopedDb,
  id: string,
  parts: unknown,
  status: MessageStatus,
): Promise<void> {
  await s.update(chatMessages, eq(chatMessages.id, id)).set({ parts, status });
}
