// Файлы домохозяйства (SEC-03, RCPT-11, STMT-10, PRIV-05): выдача владельцу. Вход — только id файла; путь на диске
// строит сервер, чужой id — NOT_FOUND. Ответ — сам файл (Content-Disposition: attachment), поэтому сайт скачивает его
// обычной ссылкой `<a href="/api/files/<id>">` с cookie сессии.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";

export const FileRef = z.strictObject({ id: z.uuid() });

/** Что загружают: фото чека или выписка (PDF, Excel, CSV, скан) — вид задаёт лимиты и белый список типов (SEC-03). */
export const UploadKind = z.enum(["receipt-photo", "statement"]);

export const UploadedFile = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
});

export const filesContract = {
  /**
   * Приём файлов (SEC-03): multipart/form-data — поле `kind` и файлы `files[0]`, `files[1]`…. Тип проверяется по
   * содержимому, а не по имени и заявленному типу; все файлы проверяются до сохранения первого.
   */
  upload: oc
    .route({ method: "POST", path: "/files" })
    .input(z.strictObject({ kind: UploadKind, files: z.array(z.file()).min(1) }))
    .output(z.strictObject({ files: z.array(UploadedFile) }))
    .errors(
      pickErrors(
        "VALIDATION",
        "UNAUTHORIZED",
        "FILE_TOO_LARGE",
        "FILE_TYPE_NOT_ALLOWED",
        "TOO_MANY_FILES",
      ),
    ),

  /** Скачать свой файл. */
  download: oc
    .route({ method: "GET", path: "/files/{id}" })
    .input(FileRef)
    .output(z.file())
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND")),
};
