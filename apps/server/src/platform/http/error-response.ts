// Тело ответа об ошибке HTTP (ADR-0005, OBS-02) — одно на все ответы сервера: процедуры oRPC, отказ охраны входа
// (Host, CSRF), неизвестный маршрут /api, /readyz. Форма — ORPCError.toJSON() oRPC 1.16.1:
// `{ defined, code, status, message, data: { requestId, params } }`. Клиент oRPC сайта узнаёт ошибку только по полной
// форме (isORPCErrorJson требует defined и message), поэтому message есть всегда — и это сам код, а не текст
// исключения: текст для человека пишет сайт по коду (`t("errors:<код>")`).
import type { ErrorCode } from "@kosht/contract";
import { toErrorBody, type ErrorBody } from "../errors/app-error.ts";

export interface HttpErrorBody extends ErrorBody {
  /** Код объявлен в .errors() процедуры (oRPC); у ответов вне процедур — false. */
  readonly defined: boolean;
  /** Всегда сам код: текста исключения наружу нет. */
  readonly message: ErrorCode;
}

/** Ошибка → тело ответа; не AppError — INTERNAL без текста (toErrorBody). */
export function httpErrorBody(error: unknown, requestId: string): HttpErrorBody {
  const body = toErrorBody(error, requestId);
  return {
    defined: false,
    code: body.code,
    status: body.status,
    message: body.code,
    data: body.data,
  };
}

/** JSON-ответ об ошибке со статусом из каталога. */
export function errorResponse(error: unknown, requestId: string): Response {
  const body = httpErrorBody(error, requestId);
  return Response.json(body, { status: body.status });
}
