// Тип файла по mime, сохранённому модулем files (он определил его по содержимому, SEC-03): вход чтения выписки.
import type { FileType } from "./types.ts";

const BY_MIME: Readonly<Record<string, FileType>> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** Тип для чтения; mime не из белого списка — undefined. */
export function fileTypeOfMime(mime: string): FileType | undefined {
  return BY_MIME[mime];
}
