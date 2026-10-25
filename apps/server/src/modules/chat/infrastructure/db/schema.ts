// Таблицы chat (CHAT-01, ARCHITECTURE §6.1): диалоги и сообщения — userOwnedTable. Сообщение хранит части
// UI-сообщения AI SDK (UIMessage.parts) как есть: при повторном открытии диалог рисуется теми же компонентами, что и
// поток. Ответ ассистента появляется строкой «идёт» до первого куска и дописывается по окончании запуска — даже если
// вкладку закрыли (запуск не привязан к соединению).
import { sql } from "drizzle-orm";
import { check, index, jsonb, text, uuid } from "drizzle-orm/pg-core";
import { ownedFk, userOwnedTable } from "../../../../platform/db/tables.ts";

export const chatConversations = userOwnedTable("chat_conversations", {
  /** Название по первому сообщению — T-043; пока null. */
  title: text(),
});

export const chatMessages = userOwnedTable(
  "chat_messages",
  {
    conversationId: uuid().notNull(),
    role: text().notNull(),
    parts: jsonb().notNull(),
    status: text().notNull().default("complete"),
  },
  (t) => [
    ...ownedFk(t, t.conversationId, chatConversations, { onDelete: "cascade" }),
    check("chat_messages_role_check", sql`${t.role} in ('user', 'assistant')`),
    check(
      "chat_messages_status_check",
      sql`${t.status} in ('streaming', 'complete', 'interrupted')`,
    ),
    index("chat_messages_created_at_idx").on(t.householdId, t.conversationId, t.createdAt),
  ],
);
