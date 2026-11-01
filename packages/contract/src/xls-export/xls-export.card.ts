// Результат инструмента `export_excel` (AGT-03, XLS-01): ссылка на скачивание за период. Схема отдельно от контракта, чтобы сайт
// подтягивал её только вместе с карточкой чата (ленивый чанк), а не в первую загрузку.
import { z } from "zod";
import { LocalDate, RowCount } from "../common.ts";

export const XlsExportLink = z.strictObject({
  from: LocalDate.schema,
  to: LocalDate.schema,
  /** Операций за период (с переводами): сколько строк будет на листе «Операции». */
  operations: RowCount,
  /** Адрес скачивания на этом же сервере (cookie сессии): файл собирается при открытии ссылки. */
  url: z.string().max(200),
});
export type XlsExportLink = z.infer<typeof XlsExportLink>;
