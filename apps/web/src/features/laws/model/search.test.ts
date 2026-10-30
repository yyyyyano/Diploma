// LEGAL-11: адрес читалки — `?article=210` роутер читает числом; ключ части («p:2») и ст. 216¹ («216.1») — строкой.
import { describe, expect, it } from "vitest";
import { LawsSearch, ReaderSearch } from "./search.ts";

describe("адрес «Базы законов»", () => {
  it.each([
    [210, "210"],
    ["210", "210"],
    [216.1, "216.1"],
    ["p:2", "p:2"],
  ])("article=%j → %j", (input, key) => {
    expect(ReaderSearch.parse({ article: input })).toEqual({ article: key });
  });

  it("неверный ключ статьи отбрасывается, а не ломает экран", () => {
    expect(ReaderSearch.parse({ article: "../etc" })).toEqual({ article: undefined });
    expect(ReaderSearch.parse({})).toEqual({ article: undefined });
  });

  it("тема, состояние и поиск: неверные значения отбрасываются, «other» — акты без темы", () => {
    expect(LawsSearch.parse({ group: "other", status: "card-only", q: " ст. 210 " })).toEqual({
      group: "other",
      status: "card-only",
      q: " ст. 210 ",
    });
    expect(LawsSearch.parse({ group: "налоги", status: 5 })).toEqual({
      group: undefined,
      status: undefined,
      q: undefined,
    });
  });
});
