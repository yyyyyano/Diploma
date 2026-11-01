// Процедуры xls-export (contract.xlsExport.*): authed — скачать книгу Excel за период. Ответ — File с типом xlsx; имя файла —
// только латиница, цифры и «-_.», поэтому заголовок Content-Disposition без экранирования (имя строит сервер, не пользователь).
import { authed } from "../../../platform/http/procedures.ts";
import type { Export } from "../application/export.ts";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function xlsExportRouter(exporter: Export) {
  return {
    download: authed.xlsExport.download.handler(async ({ input, context }) => {
      const file = await exporter.build(context.s, input);
      context.resHeaders?.set("content-disposition", `attachment; filename="${file.name}"`);
      return new File([file.bytes], file.name, { type: XLSX });
    }),
  };
}
