// LAW-21 шаг 1: обращение «ст. 210 НК», «п. 3 ст. 13 Закона о защите прав потребителей», «ст. 216¹ НК».
import { describe, expect, it } from "vitest";
import { aliasesOf } from "./aliases.ts";
import { normalizeAlias, parseReference } from "./reference.ts";
import { DEFAULT_COLLOQUIAL_TERMS, expandColloquial } from "./synonyms.ts";

describe("LAW-21: точное обращение по реквизитам", () => {
  it.each([
    ["ст. 210 НК", { articleNo: "210", point: null, actAlias: "нк" }],
    [
      "Статья 210 Налогового кодекса",
      { articleNo: "210", point: null, actAlias: "налогового кодекса" },
    ],
    ["ст.216¹ НК", { articleNo: "216.1", point: null, actAlias: "нк" }],
    ["ст. 216.1 НК", { articleNo: "216.1", point: null, actAlias: "нк" }],
    [
      "п. 3 ст. 13 Закона о защите прав потребителей",
      { articleNo: "13", point: "3", actAlias: "о защите прав потребителей" },
    ],
    ["пункт 2.1 статьи 208 НК", { articleNo: "208", point: "2.1", actAlias: "нк" }],
  ])("«%s» → %j", (query, expected) => {
    const parsed = parseReference(query);
    expect(parsed?.articleNo).toBe(expected.articleNo);
    expect(parsed?.point).toBe(expected.point);
    expect(parsed?.actAlias.endsWith(expected.actAlias)).toBe(true);
  });

  it("обычный вопрос — не обращение (идёт в гибридный поиск)", () => {
    expect(parseReference("можно ли вернуть товар без чека")).toBeNull();
    expect(parseReference("ст. 210")).toBeNull();
  });

  it("краткие имена: «НК» — два акта, падежные формы закона о защите прав потребителей", () => {
    expect(aliasesOf("Hk0200166")).toContain("нк");
    expect(aliasesOf("Hk0900071")).toContain("нк");
    expect(aliasesOf("H10200090")).toEqual(
      expect.arrayContaining([
        "закона о защите прав потребителей",
        "закону о защите прав потребителей",
      ]),
    );
    expect(normalizeAlias("Ёлка,  «Закона»")).toBe("елка закона");
  });

  it("словарь «бытовое → юридическое»: зарплата → заработная плата, исходное слово остаётся", () => {
    expect(expandColloquial(["зарплата", "задержали"], DEFAULT_COLLOQUIAL_TERMS)).toEqual([
      "зарплата",
      "задержали",
      "заработная плата",
    ]);
  });
});
