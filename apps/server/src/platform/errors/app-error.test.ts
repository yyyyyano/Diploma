import { ErrorData } from "@kosht/contract";
import { describe, expect, it } from "vitest";
import { IsolationViolation } from "../db/audit.ts";
import { AppError, toErrorBody } from "./app-error.ts";

describe("OBS-02, ADR-0005: ошибка → ответ без текста исключения", () => {
  it("AppError → код, статус каталога, requestId и параметры", () => {
    const body = toErrorBody(
      new AppError("CONFLICT", { receiptId: "r-1", uploadedOn: "2026-10-21" }),
      "req-1",
    );
    expect(body).toEqual({
      code: "CONFLICT",
      status: 409,
      data: { requestId: "req-1", params: { receiptId: "r-1", uploadedOn: "2026-10-21" } },
    });
    expect(ErrorData.parse(body.data)).toEqual(body.data);
  });

  it("повторяемые коды сохраняют свой статус: RATE_LIMITED 429, UNAVAILABLE 503", () => {
    expect(toErrorBody(new AppError("RATE_LIMITED", { retryAfterSeconds: 30 }), "r").status).toBe(
      429,
    );
    expect(toErrorBody(new AppError("UNAVAILABLE"), "r").status).toBe(503);
  });

  it("обычная ошибка → INTERNAL без текста и параметров", () => {
    const body = toErrorBody(new Error("секретный текст ivan@mail.by"), "req-2");
    expect(body).toEqual({
      code: "INTERNAL",
      status: 500,
      data: { requestId: "req-2", params: {} },
    });
  });

  it("ISOLATION_VIOLATION → INTERNAL: баг запроса наружу не объясняется", () => {
    const violation = new IsolationViolation(
      "MISSING_HOUSEHOLD_FILTER",
      "receipts",
      "добавьте s.own(receipts)",
      "select * from receipts",
    );
    expect(toErrorBody(violation, "req-3")).toMatchObject({ code: "INTERNAL", status: 500 });
    expect(JSON.stringify(toErrorBody(violation, "req-3"))).not.toContain("receipts");
  });

  it("брошена не ошибка или код вне каталога — INTERNAL", () => {
    expect(toErrorBody("строка", "r").code).toBe("INTERNAL");
    expect(toErrorBody(undefined, "r").code).toBe("INTERNAL");
    const forged = Object.assign(new AppError("CONFLICT"), { code: "NOPE" });
    expect(toErrorBody(forged, "r").code).toBe("INTERNAL");
  });

  it("параметры не по схеме (объект, длинная строка) — INTERNAL без параметров", () => {
    const nested = new AppError("CONFLICT", {
      detail: { nested: true } as unknown as string,
    });
    expect(toErrorBody(nested, "r")).toMatchObject({ code: "INTERNAL", data: { params: {} } });
    expect(toErrorBody(new AppError("CONFLICT", { text: "x".repeat(1001) }), "r").code).toBe(
      "INTERNAL",
    );
  });

  it("сообщение AppError — сам код, параметры заморожены", () => {
    const error = new AppError("NOT_FOUND", { id: "1" });
    expect(error.message).toBe("NOT_FOUND");
    expect(Object.isFrozen(error.params)).toBe(true);
  });
});
