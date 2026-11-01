// Настройки xls-export (XLS-01): сколько месяцев помещается в одну выгрузку — защита от файла на сотни тысяч строк.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** Самый длинный период одной выгрузки, в месяцах (по границам: «с 15 сентября по 5 октября» — два месяца). */
export const MAX_MONTHS = defineSetting({
  key: "xls-export.max-months",
  schema: z.int().min(1).max(120),
  default: 60,
});

export const XLS_EXPORT_SETTINGS = [MAX_MONTHS] as const;
