// Тип файла по содержимому (SEC-03): сигнатуры читает file-type, а не имя и не заявленный браузером тип.
// Здесь только перевод ответа библиотеки в белый список домена; решение «пускать ли» — domain/file-policy.ts.
import { fileTypeFromBuffer } from "file-type";
import type { DetectedType } from "../../domain/file-policy.ts";

/** Расширения file-type, которые домен знает; `cfb` — контейнер старого Excel (.xls), проверяется разбором. */
const KNOWN: Readonly<Record<string, DetectedType>> = {
  pdf: "pdf",
  xlsx: "xlsx",
  cfb: "xls",
  xls: "xls",
  jpg: "jpg",
  png: "png",
  webp: "webp",
  heic: "heic",
  heif: "heic",
};

/** Сигнатура содержимого → тип белого списка; нет сигнатуры или тип чужой — undefined (дальше решает домен). */
export async function detectType(content: Uint8Array): Promise<DetectedType | undefined> {
  const found = await fileTypeFromBuffer(content);
  if (found === undefined) return undefined;
  return KNOWN[found.ext];
}
