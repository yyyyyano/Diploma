// Схема входа инструмента для провайдера (ARCHITECTURE §8.2, CONSTRAINTS «Префикс агента ≤ 3 000 токенов»): та же Zod-схема,
// но JSON-схема в префиксе без шума, который модели не нужен, а токены съедает: регулярка даты («^(?:(?:\d\d[2468]…» —
// ~170 токенов на каждое поле), границы безопасного целого, `readOnly`, `additionalProperties: false`. Проверка вызова — настоящей схемой Zod
// (в `validate`), так что строгость прежняя; ограничение формата для модели остаётся словами `format: "date"`.
import { jsonSchema, type Schema } from "ai";
import { z } from "zod";

const SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
/** Регулярки длиннее этого — служебные (даты); короткие («^[A-Z]{3}$» у валюты) модели полезны. */
const LONG_PATTERN = 40;

type Json = Record<string, unknown>;

function compact(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(compact);
  if (typeof node !== "object" || node === null) return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node as Json)) {
    if (key === "$schema" || key === "readOnly") continue;
    // Лишние поля отвергает Zod при проверке вызова; модели повторять «false» в каждом объекте незачем.
    if (key === "additionalProperties" && value === false) continue;
    if (key === "pattern" && typeof value === "string" && value.length > LONG_PATTERN) continue;
    if (
      (key === "minimum" && value === -SAFE_INTEGER) ||
      (key === "maximum" && value === SAFE_INTEGER)
    ) {
      continue;
    }
    out[key] = compact(value);
  }
  return out;
}

/** JSON-схема входа для провайдера: компактная, по входной форме Zod-схемы (поля с умолчанием необязательны). */
export function providerJsonSchema(input: z.ZodType): Json {
  return compact(z.toJSONSchema(input, { io: "input" })) as Json;
}

/** Схема входа для AI SDK: компактный JSON для модели, проверка — Zod; значение идёт дальше как пришло. */
export function toolInputSchema(input: z.ZodType): Schema {
  return jsonSchema(providerJsonSchema(input), {
    validate: (value) => {
      const parsed = input.safeParse(value);
      return parsed.success ? { success: true, value } : { success: false, error: parsed.error };
    },
  });
}
