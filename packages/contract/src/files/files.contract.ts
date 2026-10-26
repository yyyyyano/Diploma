// Файлы домохозяйства (SEC-03, RCPT-11, STMT-10, PRIV-05): выдача владельцу. Вход — только id файла; путь на диске
// строит сервер, чужой id — NOT_FOUND. Ответ — сам файл (Content-Disposition: attachment), поэтому сайт скачивает его
// обычной ссылкой `<a href="/api/files/<id>">` с cookie сессии.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";

export const FileRef = z.strictObject({ id: z.uuid() });

export const filesContract = {
  /** Скачать свой файл. */
  download: oc
    .route({ method: "GET", path: "/files/{id}" })
    .input(FileRef)
    .output(z.file())
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND")),
};
