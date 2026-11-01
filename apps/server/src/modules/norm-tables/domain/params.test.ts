import { describe, expect, it } from "vitest";
import { numberText, paramDef, RATE_PARAMS, textHasNumber, valueInText } from "./params.ts";

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

describe("CAL-02, CAL-04: сверка значения с текстом нормы по единице", () => {
  it("месяцы: «двух лет» — 24 месяца; «трех лет» — не 24", () => {
    const text = "если недостатки обнаружены в течение двух лет со дня передачи таких товаров";
    expect(valueInText("months", 24, text)).toBe(true);
    expect(valueInText("months", 36, text)).toBe(false);
    expect(valueInText("months", 12, text)).toBe(false);
    expect(valueInText("months", 36, "в течение трех лет со дня его передачи")).toBe(true);
    expect(valueInText("months", 6, "в течение шести месяцев со дня")).toBe(true);
    expect(valueInText("months", 24, "гарантийный срок 24 месяца")).toBe(true);
  });

  it("день и месяц: «15 ноября» с неразрывным пробелом, 1115 — не «15 декабря» и не «5 ноября»", () => {
    expect(valueInText("month-day", 1115, "не позднее 15\u00a0ноября года, следующего")).toBe(true);
    expect(valueInText("month-day", 1115, "не позднее 15 декабря")).toBe(false);
    expect(valueInText("month-day", 1115, "не позднее 115 ноября")).toBe(false);
    expect(valueInText("month-day", 331, "не позднее 31 марта года, следующего")).toBe(true);
  });

  it("число месяца: «22-го числа», 22 — не «122-го числа»", () => {
    expect(valueInText("day-of-month", 22, "не позднее 22-го числа месяца, следующего")).toBe(true);
    expect(valueInText("day-of-month", 22, "не позднее 122-го числа")).toBe(false);
    expect(valueInText("day-of-month", 10, "не позднее 22-го числа")).toBe(false);
  });

  it("деньги и проценты — как прежде: отдельное число", () => {
    expect(valueInText("byn-minor", 21_600, "в размере 216 белорусских рублей")).toBe(true);
    expect(valueInText("percent-bp", 1300, "ставка 13 процентов")).toBe(true);
  });

  it("единицы реестра: у каждого параметра — известная единица и группа", () => {
    expect(paramDef("warranty.default-months")).toMatchObject({
      unit: "months",
      group: "warranty",
    });
  });
});
