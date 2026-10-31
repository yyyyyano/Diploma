import { describe, expect, it } from "vitest";
import { numberText, paramDef, RATE_PARAMS, textHasNumber } from "./params.ts";

describe("TAX-03: параметры таблицы ставок", () => {
  it("коды уникальны, у каждого есть единица и группа", () => {
    expect(new Set(RATE_PARAMS.map((p) => p.param)).size).toBe(RATE_PARAMS.length);
    expect(paramDef("ndfl.std-deduction.base")).toMatchObject({ unit: "byn-minor" });
    expect(paramDef("ndfl.rate.base")).toMatchObject({ unit: "percent-bp" });
    expect(paramDef("нет.такого")).toBeUndefined();
  });

  it("число для сверки с текстом: копейки → рубли, сотые доли процента → проценты", () => {
    expect(numberText("byn-minor", 21_600)).toBe("216");
    expect(numberText("percent-bp", 1300)).toBe("13");
    expect(numberText("byn-minor", 130_050)).toBe("1300,50");
  });
});

describe("LAW-33: число в тексте нормы", () => {
  it("находит отдельное число, а не часть другого", () => {
    expect(textHasNumber("в размере 216 белорусских рублей", "216")).toBe(true);
    expect(textHasNumber("в размере 2160 белорусских рублей", "216")).toBe(false);
    expect(textHasNumber("в размере 1216 рублей", "216")).toBe(false);
    expect(textHasNumber("доход 216,50 рубля", "216")).toBe(false);
  });

  it("число с пробелом между разрядами и без него — одно и то же", () => {
    expect(textHasNumber("не превышающей 1308 белорусских рублей", "1308")).toBe(true);
    expect(textHasNumber("не превышающей 1 308 белорусских рублей", "1308")).toBe(true);
    expect(textHasNumber("свыше 600 000 рублей", "600000")).toBe(true);
  });

  it("дробное число находится по запятой и по точке", () => {
    expect(textHasNumber("взнос 1,5 процента", "1,5")).toBe(true);
    expect(textHasNumber("взнос 1.5 процента", "1,5")).toBe(true);
  });
});
