// Общие схемы «на проводе» (ARCHITECTURE §9, .claude/rules/api-contract.md): деньги и дни — те же, что в kernel;
// страница списка (TXN-02) — номер с 1, размер 1..100 (по умолчанию 50), всего — целое ≥ 0.
import * as kernel from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { LocalDate, Money, PageNumber, PageSize, RowCount } from "./common.ts";

describe("Money и LocalDate — из kernel, а не копии", () => {
  it("контракт отдаёт те же объекты, что kernel: одна схема на сайте, сервере и в calc", () => {
    expect(Money).toBe(kernel.Money);
    expect(LocalDate).toBe(kernel.LocalDate);
  });
});

describe("PageNumber — номер страницы с 1", () => {
  it.each([
    [0, false],
    [1, true],
    [100, true],
    [101, true],
  ])("%i — %s", (value, ok) => {
    expect(PageNumber.safeParse(value).success).toBe(ok);
  });

  it("дробный номер не проходит", () => {
    expect(PageNumber.safeParse(1.5).success).toBe(false);
  });
});

describe("PageSize — размер страницы 1..100", () => {
  it.each([
    [0, false],
    [1, true],
    [100, true],
    [101, false],
  ])("%i — %s", (value, ok) => {
    expect(PageSize.safeParse(value).success).toBe(ok);
  });

  it("не задан — 50 строк (TXN-02)", () => {
    expect(PageSize.parse(undefined)).toBe(50);
  });

  it("дробный размер не проходит", () => {
    expect(PageSize.safeParse(2.5).success).toBe(false);
  });
});

describe("RowCount — сколько всего строк", () => {
  it.each([
    [-1, false],
    [0, true],
    [1, true],
    [100, true],
    [101, true],
  ])("%i — %s", (value, ok) => {
    expect(RowCount.safeParse(value).success).toBe(ok);
  });

  it("дробное число строк не проходит", () => {
    expect(RowCount.safeParse(0.5).success).toBe(false);
  });
});
