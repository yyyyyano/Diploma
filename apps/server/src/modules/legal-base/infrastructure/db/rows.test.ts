import { describe, expect, it } from "vitest";
import { one } from "./rows.ts";

describe("one: единственная строка результата", () => {
  it("возвращает первую строку", () => {
    expect(one([{ id: 1 }], "legal_acts")).toEqual({ id: 1 });
  });
  it("пустой результат — ошибка с названием таблицы, без данных", () => {
    expect(() => one([], "legal_acts")).toThrow("legal_acts");
  });
});
