// Процедуры files (contract.files.*): authed — скачать свой файл. Ответ — File с типом и именем из метаданных;
// Content-Disposition — attachment (браузер сохраняет файл, а не показывает его на странице: тип пришёл не от него).
import { FileId } from "@kosht/kernel";
import { authed } from "../../../platform/http/procedures.ts";
import type { Files } from "../application/files.ts";

/** Заголовок «скачать как»: ASCII-имя для старых клиентов и полное — в filename* (RFC 6266). */
export function attachmentHeader(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=utf-8''${encodeURIComponent(name)}`;
}

export function filesRouter(uc: Pick<Files, "open">) {
  return {
    download: authed.files.download.handler(async ({ input, context }) => {
      const file = await uc.open(context.s, FileId.parse(input.id));
      context.resHeaders?.set("content-disposition", attachmentHeader(file.name));
      return new File([file.blob], file.name, { type: file.mime });
    }),
  };
}
