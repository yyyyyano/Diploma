// Запросы к таблицам chat: первый аргумент — s: ScopedDb, у каждого обращения свой s.own (ADR-0006).
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { chatConversations, chatMessages } from "./schema.ts";

/**
 * Порядок сообщений: время, затем вопрос раньше ответа, затем id. Вопрос и строка ответа «идёт» пишутся одной транзакцией, а `now()` —
 * время её начала: у обеих строк одно `created_at`, и порядок решал бы случайный id ответа (v4 против v7 вопроса). Одинаковое время
 * бывает только у пары одного обмена, а в паре вопрос всегда первый — это и есть правило ничьей.
 */
const askedFirst = sql`(${chatMessages.role} = 'assistant')`;

export type MessageRole = "user" | "assistant";
export type MessageStatus = "streaming" | "complete" | "interrupted";

export interface MessageRow {
  readonly id: string;
  readonly role: string;
  readonly parts: unknown;
  readonly status: string;
  readonly answeredBy: unknown;
}

export interface ConversationRow {
  readonly id: string;
  readonly title: string | null;
  /** Последнее сообщение (или создание диалога, если сообщений нет) — для порядка и подписи в списке. */
  readonly updatedAt: Date;
  /** Части последнего сообщения — из них сценарий берёт начало текста. */
  readonly lastParts: unknown;
}

/** Название — null у диалога, начатого одними вложениями (текста, из которого его сделать, нет). */
export async function createConversation(s: ScopedDb, title: string | null): Promise<string> {
  const [row] = await s
    .insert(chatConversations)
    .values({ title })
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

/** Диалоги домохозяйства, свежие сверху: время и части последнего сообщения — вторым запросом на все id сразу. */
export async function listConversations(s: ScopedDb, limit: number): Promise<ConversationRow[]> {
  const conversations = await s.db
    .select({
      id: chatConversations.id,
      title: chatConversations.title,
      createdAt: chatConversations.createdAt,
    })
    .from(chatConversations)
    .where(s.own(chatConversations))
    .orderBy(desc(chatConversations.createdAt), desc(chatConversations.id))
    .limit(limit);
  if (conversations.length === 0) return [];
  const lasts = await s.db
    .selectDistinctOn([chatMessages.conversationId], {
      conversationId: chatMessages.conversationId,
      createdAt: chatMessages.createdAt,
      parts: chatMessages.parts,
    })
    .from(chatMessages)
    .where(
      and(
        s.own(chatMessages),
        inArray(
          chatMessages.conversationId,
          conversations.map((row) => row.id),
        ),
      ),
    )
    .orderBy(
      chatMessages.conversationId,
      desc(chatMessages.createdAt),
      desc(askedFirst),
      desc(chatMessages.id),
    );
  const last = new Map(lasts.map((row) => [row.conversationId, row]));
  return conversations
    .map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: last.get(row.id)?.createdAt ?? row.createdAt,
      lastParts: last.get(row.id)?.parts ?? [],
    }))
    .toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/** Название диалога своего домохозяйства; чужой или несуществующий — undefined. */
export async function conversationTitleOf(
  s: ScopedDb,
  id: string,
): Promise<{ readonly title: string | null } | undefined> {
  const rows = await s.db
    .select({ title: chatConversations.title })
    .from(chatConversations)
    .where(and(s.own(chatConversations), eq(chatConversations.id, id)));
  return rows[0];
}

/** Переименовать; false — диалога нет (или он чужой). */
export async function renameConversation(s: ScopedDb, id: string, title: string): Promise<boolean> {
  const rows = await s
    .update(chatConversations, eq(chatConversations.id, id))
    .set({ title })
    .returning({ id: chatConversations.id });
  return rows.length === 1;
}

/** Удалить диалог (сообщения уходят каскадом); false — диалога нет. */
export async function deleteConversation(s: ScopedDb, id: string): Promise<boolean> {
  const rows = await s
    .delete(chatConversations, eq(chatConversations.id, id))
    .returning({ id: chatConversations.id });
  return rows.length === 1;
}

export async function insertMessage(
  s: ScopedDb,
  message: {
    /** Заранее выбранный id: запуск попадает в реестр «живых» до записи строки (см. live-runs.ts). */
    readonly id?: string;
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
      answeredBy: chatMessages.answeredBy,
    })
    .from(chatMessages)
    .where(and(s.own(chatMessages), eq(chatMessages.conversationId, conversationId)))
    .orderBy(asc(chatMessages.createdAt), asc(askedFirst), asc(chatMessages.id));
}

/** Ответ ассистента дописан: части сообщения и итоговое состояние. */
export async function finishMessage(
  s: ScopedDb,
  id: string,
  parts: unknown,
  status: MessageStatus,
  answeredBy?: unknown,
): Promise<void> {
  await s
    .update(chatMessages, eq(chatMessages.id, id))
    .set({ parts, status, ...(answeredBy === undefined ? {} : { answeredBy }) });
}
