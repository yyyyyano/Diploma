// События statements (ADR-0004, ARCHITECTURE §5): нагрузка — id импортов, без сумм и текстов (OBS-04). Подписчики
// (дашборд, уведомления) перечитывают состояние сами.
import { z } from "zod";
import { defineEvent } from "../../platform/events/define-event.ts";

export const statementsImported = defineEvent({
  name: "statements.imported",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});

export const statementsRolledBack = defineEvent({
  name: "statements.rolled-back",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});
