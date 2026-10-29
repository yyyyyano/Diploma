// Предел размера тела запроса процедур /api (SEC-01, находка ревью T-059): процедуры принимают JSON, а файлы идут
// отдельным путём приёма файлов (T-016), поэтому по умолчанию 1 МиБ — с запасом для любой формы. Больше — VALIDATION
// до разбора тела: огромный JSON не читается в память. Значение — настройка админки (ADM-60), без переменной
// окружения: предел меняют осознанно, а не правкой .env.
import { z } from "zod";
import { defineSetting } from "../settings/settings.ts";

export const BODY_LIMIT = defineSetting({
  key: "http.body-limit-bytes",
  schema: z
    .int()
    .min(1024)
    .max(16 * 1024 * 1024),
  default: 1024 * 1024,
});

/**
 * Приём файлов — POST /api/files (multipart, SEC-03, T-025): тело — это сами файлы, поэтому предел свой. Не меньше
 * «файлов за раз × предел выписки» (10 × 25 МБ) и запас на разметку multipart; точные пределы по видам и количеству
 * проверяет модуль files по настройкам files.*. Тело всё равно обрывается до чтения, если больше (Hono bodyLimit).
 */
export const UPLOAD_BODY_LIMIT = defineSetting({
  key: "http.upload-body-limit-bytes",
  schema: z
    .int()
    .min(1024 * 1024)
    .max(1024 * 1024 * 1024),
  default: 10 * 25 * 1024 * 1024 + 1024 * 1024,
});
