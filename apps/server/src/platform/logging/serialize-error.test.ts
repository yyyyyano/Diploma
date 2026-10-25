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

  describe("OBS-04: ПД на границе 8000 символов (бывший срез до scrub) не попадает в лог", () => {
    // Десять «email» по 785 символов сжимаются scrub до 7 символов каждый: граница 8000 исходного текста
    // оказывается в первых 500 символах результата.
    const shrinking = Array.from({ length: 10 }, () => `${"a".repeat(780)}@b.cc`).join(" ");
    const BOUNDARY = 8_000;

    /** Текст, где первые `cut` символов `pii` кончаются ровно на 8000-м символе. */
    function straddling(pii: string, cut: number): string {
      const filler = "x".repeat(BOUNDARY - shrinking.length - 2 - cut);
      const head = `${shrinking} ${filler} ${pii.slice(0, cut)}`;
      expect(head).toHaveLength(BOUNDARY);
      return `${head}${pii.slice(cut)} ${"z".repeat(20_000)}`;
    }

    it.each([
      ["email", "ivan.petrov@mail.by", 15, "[email]", ["ivan", "@mai"]],
      ["карта с пробелами", "4111 1111 1111 1111", 16, "[card]", ["4111", "1111 1"]],
      ["карта с дефисами", "5500-0000-0000-0004", 12, "[card]", ["5500", "0000-0"]],
      ["IBAN BY с пробелами", "BY13 NBRB 3600 9000 0000 2Z00 AB00", 19, "[iban]", ["BY13", "NBRB"]],
      ["IBAN BY слитно", "BY13NBRB3600900000002Z00AB00", 12, "[iban]", ["BY13", "NBRB"]],
    ])("%s, оборванный на границе", (_name, pii, cut, placeholder, fragments) => {
      const message = serializeError(new Error(straddling(pii, cut))).message ?? "";
      expect(message).toContain(placeholder);
      for (const fragment of fragments) expect(message).not.toContain(fragment);
    });
  });

  it("сообщение длиннее 1 млн символов не пишется: его не прочитать целиком быстро", () => {
    const error = new Error(`ivan@mail.by ${"a".repeat(1_000_000)}`);
    const serialized = serializeError(error);
    expect(serialized).not.toHaveProperty("message");
    expect(JSON.stringify(serialized)).not.toContain("ivan");
  });

  it("сообщение в 1 млн символов без «@» (худший случай scrub) — не дольше 250 мс", () => {
    const error = new Error(`ivan@mail.by ${"a".repeat(1_000_000 - 13)}`);
    const started = performance.now();
    const serialized = serializeError(error);
    expect(performance.now() - started).toBeLessThan(250);
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
