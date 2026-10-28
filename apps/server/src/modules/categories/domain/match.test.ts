// CAT-03, CAT-04, CAT-07: ключевые слова, позиции чека и MCC — самое длинное совпадение с начала слова, по типу.
import { describe, expect, it } from "vitest";
import { matchMcc, matchText, type GlobalRule } from "./match.ts";

const rules: GlobalRule[] = [
  { matcher: "keyword", pattern: "ТАКСИ", categoryCode: "taxi" },
  { matcher: "keyword", pattern: "ПОГАШЕНИЕ", categoryCode: "loans" },
  { matcher: "keyword", pattern: "ЗАРПЛАТ", categoryCode: "salary" },
  { matcher: "item", pattern: "СОК", categoryCode: "groceries" },
  { matcher: "item", pattern: "МАСЛО", categoryCode: "groceries" },
  { matcher: "item", pattern: "БАЛЬЗАМ ДЛЯ ВОЛОС", categoryCode: "beauty" },
  { matcher: "item", pattern: "БАЛЬЗАМ", categoryCode: "health" },
  { matcher: "mcc", pattern: "5411", categoryCode: "groceries" },
];
const expense = (code: string) => code !== "salary";

describe("CAT-03: ключевые слова в описании", () => {
  it("«ТАКСИ 7788» → «Такси»; CAT-07: «ПОГАШЕНИЕ КРЕДИТА» → «Кредиты и займы»", () => {
    expect(matchText(["ТАКСИ 7788"], rules, "keyword", expense)?.categoryCode).toBe("taxi");
    expect(
      matchText(["ПОГАШЕНИЕ КРЕДИТА ПО ДОГОВОРУ"], rules, "keyword", expense)?.categoryCode,
    ).toBe("loans");
  });

  it("правило не того типа не подходит: «ЗАРПЛАТА» у расхода — нет", () => {
    expect(matchText(["ЗАРПЛАТА ЗА МАРТ"], rules, "keyword", expense)).toBeUndefined();
    expect(matchText(["ЗАРПЛАТА ЗА МАРТ"], rules, "keyword", () => true)?.categoryCode).toBe(
      "salary",
    );
  });
});

describe("CAT-04: позиции чека", () => {
  it("«БАЛЬЗАМ ДЛЯ ВОЛОС» — самое длинное совпадение, а не «БАЛЬЗАМ»", () => {
    expect(matchText(["БАЛЬЗАМ ДЛЯ ВОЛОС"], rules, "item", expense)?.categoryCode).toBe("beauty");
  });

  it("шаблон — с начала слова: «СОК» в «ПЕСОК» не подходит", () => {
    expect(matchText(["ПЕСОК СТРОИТЕЛЬНЫЙ"], rules, "item", expense)).toBeUndefined();
    expect(matchText(["СОК ЯБЛОЧНЫЙ"], rules, "item", expense)?.categoryCode).toBe("groceries");
  });
});

describe("CAT-03: MCC", () => {
  it("код есть в правилах — категория; нет кода или чужой — ничего", () => {
    expect(matchMcc("5411", rules, expense)?.categoryCode).toBe("groceries");
    expect(matchMcc("9999", rules, expense)).toBeUndefined();
    expect(matchMcc(null, rules, expense)).toBeUndefined();
    expect(matchMcc(undefined, rules, expense)).toBeUndefined();
  });
});
