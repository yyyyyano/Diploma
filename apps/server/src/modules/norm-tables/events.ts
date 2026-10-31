// События norm-tables (ADR-0004): значения подтверждены администратором — калькулятор и чек-листы пересчитывают то, что от них
// зависит. Публикуется от имени подтвердившего администратора (`s`), в нагрузке — только id строк.
import { z } from "zod";
import { defineEvent } from "../../platform/events/define-event.ts";

export const valuesConfirmed = defineEvent({
  name: "norm-tables.values-confirmed",
  payload: z.object({ ids: z.array(z.uuid()).min(1) }),
});
