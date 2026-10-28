// События profile (ADR-0004, ARCHITECTURE §5): нагрузка — пачка id изменённых фактов, без значений (OBS-04).
// Подписчик (налоги, календарь) перечитывает факты сам через фасад.
import { z } from "zod";
import { defineEvent } from "../../platform/events/define-event.ts";

/** Факты профиля изменились (анкета, чат, вывод системы, правка на странице, «Отменить»). */
export const factsChanged = defineEvent({
  name: "profile.facts-changed",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});
