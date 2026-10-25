// Владелец данных chat (PRIV-05/06): переписка выгружается в «Мои данные» и удаляется с аккаунтом — сообщения
// раньше диалогов (составной FK).
import { defineUserData } from "../../platform/db/user-data.ts";
import { chatConversations, chatMessages } from "./infrastructure/db/schema.ts";

export const chatUserData = defineUserData({ tables: [chatMessages, chatConversations] });
