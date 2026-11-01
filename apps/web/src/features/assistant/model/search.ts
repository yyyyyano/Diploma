// Адрес страницы «Ассистент»: открытый диалог — `?c=<id>` (ссылку можно сохранить; «назад» не теряет диалог). Неверное
// значение отбрасывается: адрес, набранный руками, экран не ломает.
import { ConversationId } from "@kosht/contract";
import { z } from "zod";

export const AssistantSearch = z.object({
  c: ConversationId.optional().catch(undefined),
});
export type AssistantSearch = z.infer<typeof AssistantSearch>;
