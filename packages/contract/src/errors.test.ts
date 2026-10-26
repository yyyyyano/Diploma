// ADR-0005, ARCHITECTURE §9: каталог ошибок — единственный источник кодов, HTTP-статусов и повторяемости. Процедура
// объявляет свои коды через pickErrors, текст для человека — в словаре errors (@kosht/i18n), не на сервере.
import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERRORS, ErrorData, isRetryable, pickErrors } from "./errors.ts";

describe("каталог ошибок", () => {
  it("базовые коды и коды входа (AUTH-01, AUTH-03, AUTH-08) с HTTP-статусами", () => {
    expect(Object.fromEntries(ERROR_CODES.map((code) => [code, ERRORS[code].status]))).toEqual({
      VALIDATION: 400,
      UNAUTHORIZED: 401,
      INVALID_CREDENTIALS: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      EMAIL_TAKEN: 409,
      LINK_INVALID: 410,
      RATE_LIMITED: 429,
      INTERNAL: 500,
      UNAVAILABLE: 503,
    });
  });

  it("повторять имеет смысл только RATE_LIMITED и UNAVAILABLE", () => {
    expect(ERROR_CODES.filter((code) => isRetryable(code))).toEqual([
      "RATE_LIMITED",
      "UNAVAILABLE",
    ]);
  });
});

describe("ErrorData — данные ошибки на проводе: requestId и параметры для текста", () => {
  it("параметры — строки, числа и флаги для подстановки в текст", () => {
    const data = { requestId: "req-1", params: { receiptId: "r-1", lines: 3, retried: false } };
    expect(ErrorData.parse(data)).toEqual(data);
  });

  it("без requestId данные не проходят: по нему ищут запись в логах (make log-find)", () => {
    expect(ErrorData.safeParse({ params: {} }).success).toBe(false);
  });

  it("лишнее поле (например, текст исключения) не проходит", () => {
    expect(ErrorData.safeParse({ requestId: "req-1", params: {}, message: "stack" }).success).toBe(
      false,
    );
  });

  it("объект в параметре не проходит: параметры — только значения для подстановки", () => {
    expect(ErrorData.safeParse({ requestId: "req-1", params: { nested: { a: 1 } } }).success).toBe(
      false,
    );
  });
});

describe("pickErrors — карта ошибок oRPC из кодов каталога", () => {
  it("каждый код получает статус из каталога и схему данных { requestId, params }", () => {
    expect(pickErrors("NOT_FOUND", "RATE_LIMITED")).toEqual({
      NOT_FOUND: { status: 404, data: ErrorData },
      RATE_LIMITED: { status: 429, data: ErrorData },
    });
  });

  it("без кодов — пустая карта", () => {
    expect(pickErrors()).toEqual({});
  });

  it("кода нет в каталоге — не компилируется, а в обход типов — ошибка", () => {
    // @ts-expect-error — RECEIPT_DUPLICATE ещё не в каталоге: новый код сначала добавляют в errors.ts
    expect(() => pickErrors("RECEIPT_DUPLICATE")).toThrow(RangeError);
  });
});
