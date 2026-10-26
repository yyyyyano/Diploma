// Код ошибки ответа сервера для текста человеку (ADR-0005, ARCHITECTURE §9): ORPCError с кодом каталога — этот код,
// всё прочее (сеть, неожиданный ответ) — INTERNAL. Текст — t(`errors:${код}`, параметры) из словаря errors.
import { ERROR_CODES, ErrorParams, type ErrorCode } from "@kosht/contract";
import { ORPCError } from "@orpc/client";

export function errorCodeOf(error: unknown): ErrorCode {
  if (error instanceof ORPCError) {
    const known = ERROR_CODES.find((code) => code === error.code);
    if (known !== undefined) return known;
  }
  return "INTERNAL";
}

/** Параметры текста ошибки: всё из data.params ответа; минуты ожидания есть всегда (по умолчанию 1). */
export type ErrorTextParams = Record<string, string | number | boolean> & {
  readonly retryAfterMinutes: number;
};

/** Параметры для подстановки в текст ошибки («через {{retryAfterMinutes}} мин.»); нет или не по схеме — умолчания. */
export function errorParamsOf(error: unknown): ErrorTextParams {
  const data: unknown = error instanceof ORPCError ? error.data : undefined;
  const params =
    typeof data === "object" && data !== null ? (data as { params?: unknown }).params : undefined;
  const parsed = ErrorParams.safeParse(params);
  const found = parsed.success ? parsed.data : {};
  const minutes = found["retryAfterMinutes"];
  return { ...found, retryAfterMinutes: typeof minutes === "number" ? minutes : 1 };
}
