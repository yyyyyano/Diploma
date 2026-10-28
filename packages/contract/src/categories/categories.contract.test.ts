// CAT-01: встроенные категории — 26 расходных и 7 доходных, коды уникальны, цвета — из таблицы дизайн-системы.
import { describe, expect, it } from "vitest";
import {
  CategoryRef,
  FALLBACK_CATEGORY,
  NewCategoryInput,
  SYSTEM_CATEGORIES,
} from "./categories.contract.ts";

describe("CAT-01: встроенные категории", () => {
  it("26 расходных и 7 доходных, коды не повторяются", () => {
    expect(SYSTEM_CATEGORIES.filter((c) => c.kind === "expense")).toHaveLength(26);
    expect(SYSTEM_CATEGORIES.filter((c) => c.kind === "income")).toHaveLength(7);
    expect(new Set(SYSTEM_CATEGORIES.map((c) => c.code)).size).toBe(33);
  });

  it("«Прочее» — встроенная своего типа; «Кредиты и займы» — расходная (CAT-07)", () => {
    const kindOf = (code: string) => SYSTEM_CATEGORIES.find((c) => c.code === code)?.kind;
    expect(kindOf(FALLBACK_CATEGORY.expense)).toBe("expense");
    expect(kindOf(FALLBACK_CATEGORY.income)).toBe("income");
    expect(kindOf("loans")).toBe("expense");
  });
});

describe("CAT-02: ссылка и своя категория", () => {
  it("ссылка — ровно одно: код встроенной или id своей; чужой код не проходит", () => {
    expect(CategoryRef.safeParse({ type: "system", code: "taxi" }).success).toBe(true);
    expect(CategoryRef.safeParse({ type: "system", code: "no-such" }).success).toBe(false);
    expect(
      CategoryRef.safeParse({
        type: "custom",
        id: "0199f0a0-0000-7000-8000-0000000000aa",
        code: "taxi",
      }).success,
    ).toBe(false);
  });

  it("новая категория: название без пустоты, иконка и цвет по умолчанию", () => {
    expect(NewCategoryInput.parse({ name: " Кружки ", kind: "expense" })).toEqual({
      name: "Кружки",
      kind: "expense",
      icon: "circle-ellipsis",
      color: "other",
    });
    expect(NewCategoryInput.safeParse({ name: " ", kind: "expense" }).success).toBe(false);
  });
});
