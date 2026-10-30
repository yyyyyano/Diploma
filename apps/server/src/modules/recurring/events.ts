// События recurring (ADR-0004, ARCHITECTURE §5): нагрузка — пачка id регулярных платежей, у которых что-то изменилось
// (найден, пересчитан, решение человека, «возможно прекращён»), без сумм и названий (OBS-04). Подписчики (fin, calendar,
// dashboard) перечитывают состояние через фасад.
import { z } from "zod";
import { defineEvent } from "../../platform/events/define-event.ts";

export const recurringChanged = defineEvent({
  name: "recurring.changed",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});
