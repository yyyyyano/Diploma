// Пределы приёма файлов (SEC-03, T-025): настройки админки (ADM-60), не константы. Предел тела запроса приёма —
// платформенная настройка http.upload-body-limit-bytes: не меньше «файлов за раз × предел выписки».
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

const MIB = 1024 * 1024;

/** Фото чека (RCPT-01): снимок с телефона — до 15 МБ. */
export const FILES_MAX_PHOTO_BYTES = defineSetting({
  key: "files.max-photo-bytes",
  schema: z
    .int()
    .min(MIB)
    .max(100 * MIB),
  default: 15 * MIB,
});

/** Выписка (PDF, Excel, CSV, скан): до 25 МБ. */
export const FILES_MAX_STATEMENT_BYTES = defineSetting({
  key: "files.max-statement-bytes",
  schema: z
    .int()
    .min(MIB)
    .max(100 * MIB),
  default: 25 * MIB,
});

/** Файлов за один раз: до 10 (RCPT-01, STMT-03). */
export const FILES_MAX_PER_UPLOAD = defineSetting({
  key: "files.max-per-upload",
  schema: z.int().min(1).max(50),
  default: 10,
});
