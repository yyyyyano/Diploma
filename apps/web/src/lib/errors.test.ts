import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { errorCodeOf, errorParamsOf } from "./errors.ts";

describe("код ошибки для текста человеку", () => {
  it("код каталога из ответа сервера — он сам", () => {
    expect(errorCodeOf(new ORPCError("INVALID_CREDENTIALS"))).toBe("INVALID_CREDENTIALS");
  });

  it("чужой код, сбой сети и прочее — INTERNAL", () => {
    expect(errorCodeOf(new ORPCError("TEAPOT"))).toBe("INTERNAL");
    expect(errorCodeOf(new TypeError("Failed to fetch"))).toBe("INTERNAL");
  });
});

describe("параметры текста ошибки", () => {
  it("параметры из data.params ответа — для подстановки в текст", () => {
    const error = new ORPCError("RATE_LIMITED", {
      data: { requestId: "req-1", params: { retryAfterMinutes: 5 } },
    });
    expect(errorParamsOf(error)).toEqual({ retryAfterMinutes: 5, name: "файл" });
  });

  it("имя файла из ответа об ошибке загрузки подставляется в текст", () => {
    const error = new ORPCError("FILE_TYPE_NOT_ALLOWED", {
      data: { requestId: "req-1", params: { name: "выписка.pdf" } },
    });
    expect(errorParamsOf(error)).toEqual({ retryAfterMinutes: 1, name: "выписка.pdf" });
  });

  it("нет параметров, не та форма или не ошибка сервера — минуты и имя файла по умолчанию", () => {
    const fallback = { retryAfterMinutes: 1, name: "файл" };
    expect(errorParamsOf(new ORPCError("CONFLICT"))).toEqual(fallback);
    expect(
      errorParamsOf(new ORPCError("CONFLICT", { data: { params: { nested: { a: 1 } } } })),
    ).toEqual(fallback);
    expect(errorParamsOf(new TypeError("Failed to fetch"))).toEqual(fallback);
  });
});
