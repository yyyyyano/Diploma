// RCPT-13: позиции с гарантией — по категории и по наименованию.
import { describe, expect, it } from "vitest";
import { hasWarranty } from "./warranty.ts";

describe("RCPT-13: гарантия", () => {
  it("категория «Электроника» — гарантия, что бы ни было в названии", () => {
    expect(hasWarranty("electronics", "Кабель")).toBe(true);
  });

  it.each([
    "Холодильник Атлант",
    "Чайник электрический 1,7л",
    "Смартфон X 128Гб",
    "Стиральная машина",
  ])("наименование «%s» — гарантия", (name) => {
    expect(hasWarranty("home", name)).toBe(true);
  });

  it.each(["Молоко 3,2% 1л", "Хлеб", "Фенхель сушёный"])("«%s» — без гарантии", (name) => {
    expect(hasWarranty("groceries", name)).toBe(false);
  });
});
