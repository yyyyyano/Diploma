// Ошибки приложения (ARCHITECTURE §9, ADR-0005, OBS-02): код из каталога @kosht/contract и параметры для
// подстановки в текст — а не текст. Перевод в ответ — одна чистая функция toErrorBody: каждый вход (oRPC — T-059,
// инструмент агента, задача) отвечает одинаково. Всё, что не AppError, — INTERNAL без текста исключения: стек
// пишет в лог вызывающий (log.error({ err }, …)), наружу уходит только requestId для поиска (make log-find).
// ISOLATION_VIOLATION аудитора SQL — тоже INTERNAL: это баг запроса, а не ответ пользователю.
import { ERRORS, ErrorParams, type ErrorCode } from "@kosht/contract";
import type { z } from "zod";

export type AppErrorParams = z.infer<typeof ErrorParams>;

export class AppError extends Error {
  override readonly name = "AppError";
  readonly code: ErrorCode;
  readonly params: Readonly<AppErrorParams>;

  /** `new AppError("CONFLICT", { receiptId })`; сообщение — сам код (в лог он и попадёт). */
  constructor(code: ErrorCode, params: AppErrorParams = {}, options?: ErrorOptions) {
    super(code, options);
    this.code = code;
    this.params = Object.freeze({ ...params });
  }
}

/** Тело ответа об ошибке: `{ code, status, data: { requestId, params } }` (ErrorData контракта). */
export interface ErrorBody {
  readonly code: ErrorCode;
  readonly status: number;
  readonly data: { readonly requestId: string; readonly params: AppErrorParams };
}

/** Ошибка → тело ответа; неизвестное и параметры не по схеме — INTERNAL без текста и параметров. */
export function toErrorBody(error: unknown, requestId: string): ErrorBody {
  if (error instanceof AppError && Object.hasOwn(ERRORS, error.code)) {
    const params = ErrorParams.safeParse(error.params);
    if (params.success) {
      return {
        code: error.code,
        status: ERRORS[error.code].status,
        data: { requestId, params: params.data },
      };
    }
  }
  return { code: "INTERNAL", status: ERRORS.INTERNAL.status, data: { requestId, params: {} } };
}
