// TXN-02: адрес «Операций» — фильтры и страница в адресе; неверное значение отбрасывается; вход списка собирается по адресу.
import { describe, expect, it } from "vitest";
import {
  amountMinor,
  hasFilters,
  OperationsSearch,
  parseCategoryKey,
  toListInput,
} from "./search.ts";

const ID = "0199c1a0-0000-7000-8000-000000000001";

describe("TXN-02: адрес экрана «Операции»", () => {
  it("пустой адрес — первая страница по 50 без фильтров", () => {
    const search = OperationsSearch.parse({});
    expect(toListInput(search)).toEqual({ page: 1, pageSize: 50 });
    expect(hasFilters(search)).toBe(false);
  });

  it("все фильтры из адреса попадают во вход списка; сумма — копейки BYN, «10,5» → 1050", () => {
    const search = OperationsSearch.parse({
      page: "3",
      q: " кофе ",
      type: "expense",
      from: "2026-10-01",
      to: "2026-10-31",
      account: ID,
      category: "system:taxi",
      min: "10,5",
      max: "200",
      source: "statement",
    });
    expect(toListInput(search)).toEqual({
      page: 3,
      pageSize: 50,
      query: "кофе",
      from: "2026-10-01",
      to: "2026-10-31",
      accountId: ID,
      categoryCode: "taxi",
      type: "expense",
      amountFrom: 1050,
      amountTo: 20_000,
      source: "statement",
    });
    expect(hasFilters(search)).toBe(true);
  });

  it("своя категория — categoryId; неизвестный код и мусор в адресе отбрасываются", () => {
    expect(parseCategoryKey(`custom:${ID}`)).toEqual({ type: "custom", id: ID });
    expect(parseCategoryKey("system:нет-такой")).toBeUndefined();
    expect(parseCategoryKey("taxi")).toBeUndefined();
    const search = OperationsSearch.parse({
      type: "что-то",
      page: "0",
      from: "вчера",
      category: "x",
    });
    expect(search).toEqual({});
  });

  it("сумма не число — фильтр не применяется; страница из «Показать ещё» подменяет номер", () => {
    expect(amountMinor("много")).toBeUndefined();
    expect(amountMinor("  ")).toBeUndefined();
    expect(toListInput(OperationsSearch.parse({ page: "2" }), 5)).toMatchObject({ page: 5 });
  });

  it("TXN-01: фильтр «С чеком» и «Чек требует проверки» — hasReceipt и needsReview во входе списка", () => {
    const withReceipt = OperationsSearch.parse({ receipt: "with" });
    expect(toListInput(withReceipt)).toEqual({ page: 1, pageSize: 50, hasReceipt: true });
    expect(hasFilters(withReceipt)).toBe(true);
    expect(toListInput(OperationsSearch.parse({ receipt: "review" }))).toEqual({
      page: 1,
      pageSize: 50,
      needsReview: true,
    });
    expect(OperationsSearch.parse({ receipt: "что-то" }).receipt).toBeUndefined();
  });
});
