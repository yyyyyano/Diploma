// ARCHITECTURE §8.2: схема входа для модели компактна (без регулярки даты), а проверка вызова — прежняя, строгая.
import { LocalDate } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { providerJsonSchema, toolInputSchema } from "./tool-schema.ts";

const input = z.strictObject({
  day: LocalDate.schema,
  amount: z.number().int(),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  note: z.string().max(10).default("x"),
  limit: z.number().max(50).optional(),
  ids: z.array(z.string()).max(5).optional(),
});

describe("providerJsonSchema", () => {
  const schema = providerJsonSchema(input);
  const text = JSON.stringify(schema);

  it("регулярки даты и границы безопасного целого убраны, формат даты остался", () => {
    expect(text).not.toContain("[2468][048]");
    expect(text).not.toContain("9007199254740991");
    expect(text).toContain('"format":"date"');
  });

  it("верхние границы (maximum, maxLength, maxItems) убраны: провайдер из-за них обрывает ответ ошибкой 400", () => {
    expect(text).not.toContain("maximum");
    expect(text).not.toContain("maxLength");
    expect(text).not.toContain("maxItems");
  });

  it("короткая регулярка валюты остаётся: модели она подсказывает формат", () => {
    expect(text).toContain("^[A-Z]{3}$");
  });

  it("поле с умолчанием не обязательно; служебные ключи убраны", () => {
    expect(schema["required"]).toEqual(["day", "amount", "currency"]);
    expect(text).not.toContain("additionalProperties");
    expect(text).not.toContain("$schema");
  });
});

describe("toolInputSchema: проверка — настоящей схемой Zod", () => {
  const schema = toolInputSchema(input);
  const validate = schema.validate;
  if (validate === undefined) throw new Error("у схемы должна быть проверка");

  it("верный вызов проходит и идёт дальше как пришёл", async () => {
    const value = { day: "2026-10-31", amount: 5, currency: "BYN" };
    expect(await validate(value)).toEqual({ success: true, value });
  });

  it("превышение предела (limit 100 при максимуме 50) отвергает Zod: ошибка вернётся модели результатом вызова", async () => {
    const result = await validate({ day: "2026-10-31", amount: 5, currency: "BYN", limit: 100 });
    expect(result.success).toBe(false);
  });

  it("несуществующий день (2026-02-31) и лишнее поле — отказ", async () => {
    expect((await validate({ day: "2026-02-31", amount: 5, currency: "BYN" })).success).toBe(false);
    expect((await validate({ day: "2026-10-31", amount: 5, currency: "BYN", x: 1 })).success).toBe(
      false,
    );
  });
});
