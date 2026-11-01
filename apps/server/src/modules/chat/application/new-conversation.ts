// «/new» в боте (TG-05): начать разговор с чистого контекста — новый пустой диалог канала; следующее сообщение пойдёт в
// него, прежний останется в базе (долговременная память — факты профиля — не затрагивается).
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { createConversation, type ChatChannel } from "../infrastructure/db/chat.repo.ts";

export function makeStartNewConversation() {
  return async function startNew(s: ScopedDb, channel: ChatChannel, at?: Date): Promise<void> {
    await createConversation(s, null, channel, at);
  };
}
