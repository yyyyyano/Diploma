// События legal-base (ADR-0004): системные события общей базы — у них нет своего владельца. Публикуются от имени первого
// активного администратора (`identity.publishSystemEvent`), как `identity.system-initialized`; нагрузка — id актов пачкой.
import { z } from "zod";
import { defineEvent } from "../../platform/events/define-event.ts";

const ActIds = z.object({ ids: z.array(z.uuid()).min(1) });

/** Появилась новая редакция акта (LAW-31): norm-tables сверяет числа ставок (LAW-33). */
export const actUpdated = defineEvent({ name: "legal-base.act-updated", payload: ActIds });

/** Акт утратил силу (LAW-34): выходит из поиска, ответы называют дату и замену. */
export const actRepealed = defineEvent({ name: "legal-base.act-repealed", payload: ActIds });
