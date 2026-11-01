// Таблицы chat (CHAT-01, ARCHITECTURE §6.1): диалоги и сообщения — userOwnedTable. Сообщение хранит части
// UI-сообщения AI SDK (UIMessage.parts) как есть: при повторном открытии диалог рисуется теми же компонентами, что и
// поток. Ответ ассистента появляется строкой «идёт» до первого куска и дописывается по окончании запуска — даже если
// вкладку закрыли (запуск не привязан к соединению).
import { sql } from "drizzle-orm";
import { check, index, jsonb, text, uuid } from "drizzle-orm/pg-core";
import { ownedFk, userOwnedTable } from "../../../../platform/db/tables.ts";

export const CHAT_CHANNELS = ["web", "telegram"] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export const chatConversations = userOwnedTable(
  "chat_conversations",
  {
    /** CHAT-01: первое сообщение, обрезанное по слову (без модели); у диалогов до T-043 — null. */
    title: text(),
    /** TG-05, AGT-11: у каналов своя история — диалоги бота на сайте не показываются. */
    channel: text().$type<ChatChannel>().notNull().default("web"),
  },
  (t) => [check("chat_conversations_channel_check", sql`${t.channel} in ('web', 'telegram')`)],
);

export const chatMessages = userOwnedTable(
  "chat_messages",
  {
    conversationId: uuid().notNull(),
    role: text().notNull(),
    parts: jsonb().notNull(),
    status: text().notNull().default("complete"),
    /** LLM-10: `{ model, unavailable }` — кто ответил; пометка «Модель X недоступна» переживает перезагрузку. */
    answeredBy: jsonb(),
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
