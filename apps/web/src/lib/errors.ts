// Код ошибки ответа сервера для текста человеку (ADR-0005, ARCHITECTURE §9): ORPCError с кодом каталога — этот код,
// всё прочее (сеть, неожиданный ответ) — INTERNAL. Текст — t(`errors:${код}`) из словаря errors.
import { ERROR_CODES, type ErrorCode } from "@kosht/contract";
import { ORPCError } from "@orpc/client";

export function errorCodeOf(error: unknown): ErrorCode {
  if (error instanceof ORPCError) {
    const known = ERROR_CODES.find((code) => code === error.code);
    if (known !== undefined) return known;
  }
  return "INTERNAL";
}
