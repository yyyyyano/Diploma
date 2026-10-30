// События transactions (ADR-0004, ARCHITECTURE §5): нагрузка — пачка id операций, которые добавлены, изменены или
// удалены одним действием, без сумм и текстов (OBS-04). Подписчики (бюджеты, регулярные, дашборд) перечитывают
// состояние сами.
import { z } from "zod";
import { defineEvent } from "../../platform/events/define-event.ts";

export const transactionsChanged = defineEvent({
  name: "transactions.changed",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});

/** Чек и платёж по карте стали одной операцией (TXN-10): нагрузка — id операции выписки, которая осталась. */
export const transactionsMerged = defineEvent({
  name: "transactions.merged",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});
