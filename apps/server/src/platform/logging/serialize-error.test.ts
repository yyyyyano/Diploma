import { describe, expect, it } from "vitest";
import { serializeError } from "./serialize-error.ts";

/** Ошибка той формы, что бросает pg (DatabaseError): code, severity, detail, constraint, table. */
function pgError(): Error {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "items_name_key"'),
    {
      name: "error",
      severity: "ERROR",
      code: "23505",
      detail: "Key (name)=(Молоко 2,49) already exists.",
      where: "SQL statement «insert … Молоко 2,49»",
      hint: "Молоко 2,49",
      constraint: "items_name_key",
      table: "items",
      schema: "public",
    },
  );
}

describe("OBS-02: ошибка в логе — стек и контекст без данных", () => {
  it("ошибка Postgres: code, constraint, table и кадры стека; message, detail, where не пишутся", () => {
    const serialized = serializeError(pgError());
    expect(serialized).toMatchObject({
      type: "error",
      code: "23505",
      constraint: "items_name_key",
      table: "items",
      schema: "public",
    });
    expect(serialized.stack.length).toBeGreaterThan(0);
    expect(serialized.stack.every((frame) => frame.startsWith("at "))).toBe(true);
    expect(JSON.stringify(serialized)).not.toMatch(/Молоко|2,49|duplicate key/);
  });

  it("DrizzleQueryError: параметры запроса из сообщения не пишутся, причина — как ошибка pg", () => {
    const drizzle = Object.assign(
      new Error("Failed query: insert into items values ($1)\nparams: Молоко 2,49"),
      { name: "DrizzleQueryError", cause: pgError() },
    );
    const serialized = serializeError(drizzle);
    expect(serialized).toMatchObject({ type: "DrizzleQueryError", cause: { code: "23505" } });
    expect(JSON.stringify(serialized)).not.toMatch(/Молоко|params/);
  });

  it("прочая ошибка: имя, код, reason, scrub(message) и кадры стека без строки сообщения", () => {
    const error = Object.assign(new Error("нет пользователя ivan@mail.by"), {
      code: "USER_MISSING",
      reason: "NO_HOUSEHOLD_FILTER",
    });
    const serialized = serializeError(error);
    expect(serialized).toMatchObject({
      type: "Error",
      code: "USER_MISSING",
      reason: "NO_HOUSEHOLD_FILTER",
      message: "нет пользователя [email]",
    });
    expect(JSON.stringify(serialized)).not.toContain("ivan@mail.by");
    expect(serialized.stack.some((frame) => frame.includes("нет пользователя"))).toBe(false);
  });

  it("сообщение в 200 тыс. символов без «@» — scrub не дольше 250 мс, в лог — 500 символов", () => {
    const error = new Error(`ivan@mail.by ${"a".repeat(200_000)}`);
    const started = performance.now();
    const serialized = serializeError(error);
    expect(performance.now() - started).toBeLessThan(250);
    expect(serialized.message).toHaveLength(500);
    expect(serialized.message?.startsWith("[email] aaa")).toBe(true);
  });

  it("код и имя не токены (текст, значения) — не пишутся", () => {
    const error = Object.assign(new Error("x"), { code: "Молоко 2,49", name: "Ошибка с данными" });
    const serialized = serializeError(error);
    expect(serialized).toMatchObject({ type: "Error" });
    expect(serialized).not.toHaveProperty("code");
  });

  it("брошена не ошибка — только её вид", () => {
    expect(serializeError("пароль 12345")).toEqual({ type: "string", stack: [] });
    expect(serializeError({ amount: 249 })).toEqual({ type: "object", stack: [] });
    expect(serializeError(null)).toEqual({ type: "null", stack: [] });
  });

  it("цепочка причин — не глубже трёх уровней", () => {
    let error = new Error("корень");
    for (let i = 0; i < 6; i += 1) error = new Error(`уровень ${String(i)}`, { cause: error });
    const serialized = serializeError(error);
    expect(serialized.cause?.cause?.cause).toBeDefined();
    expect(serialized.cause?.cause?.cause?.cause).toBeUndefined();
  });
});
