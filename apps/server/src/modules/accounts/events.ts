// События accounts (ADR-0004, ARCHITECTURE §5): нагрузка — пачка id счетов, у которых изменился остаток (начальный
// остаток, операции, удаление), без сумм (OBS-04). Подписчик перечитывает остатки сам.
import { z } from "zod";
import { defineEvent } from "../../platform/events/define-event.ts";

export const balancesChanged = defineEvent({
  name: "accounts.balances-changed",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});
