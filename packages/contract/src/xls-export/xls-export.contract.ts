// Выгрузка в Excel (XLS-01…04): файл собирается по запросу и нигде не хранится. Период — `from`…`to` (обе границы входят);
// не указан — текущий месяц по часам системы. Ответ — сам файл (Content-Disposition: attachment), как в `files.download`.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { LocalDate } from "../common.ts";
import { pickErrors } from "../errors.ts";

export const xlsExportContract = {
  /** XLS-01: книга Excel за период — листы «Операции», «Сводка», «Лимиты» с живыми формулами. */
  download: oc
    .route({ method: "GET", path: "/xls-export" })
    .input(z.strictObject({ from: LocalDate.schema.optional(), to: LocalDate.schema.optional() }))
    .output(z.file())
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED")),
};
