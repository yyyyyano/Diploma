// STMT-06, RCPT-15: очистка названий контрагентов и нормализация наименований позиций.
import { describe, expect, it } from "vitest";
import { cleanDescription, normalizeItemName, titleCase } from "./clean-name.ts";

describe("STMT-06: очистка названий от технического шума", () => {
  it("«OOO EVROTORG T-0042 MINSK UL…» → ключ «EVROTORG»", () => {
    expect(cleanDescription("OOO EVROTORG T-0042 MINSK UL. LENINA 12")).toEqual({
      key: "EVROTORG",
      mcc: null,
    });
  });

  it.each([
    ["POKUPKA SANTA RETAIL GRODNO", "SANTA"],
    ["ЧТУП «Табакерка» г. Минск", "ТАБАКЕРКА"],
    ["Оплата ТАКСИ 7788", "ТАКСИ"],
    ["YANDEX.GO TERM 12345 BY", "YANDEX.GO"],
    ['ООО "Белмаркет" №15', "БЕЛМАРКЕТ"],
  ])("«%s» → «%s»", (raw, key) => {
    expect(cleanDescription(raw).key).toBe(key);
  });

  it("код MCC вынимается отдельно и из названия убирается", () => {
    expect(cleanDescription("APTEKA 36.6 MCC 5912 MINSK")).toEqual({ key: "APTEKA", mcc: "5912" });
  });

  it("только шум — пустой ключ", () => {
    expect(cleanDescription("POS 123456 MINSK").key).toBe("");
  });

  it("название без справочника — с заглавных букв", () => {
    expect(titleCase("ТАКСИ СВОИ")).toBe("Такси Свои");
    expect(titleCase("")).toBe("");
  });
});

describe("RCPT-15: наименования позиций без веса и жирности", () => {
  it.each([
    ["Молоко 3,2% 1л", "Молоко"],
    ["МОЛОКО ПАСТ. 2,5% 900Г", "Молоко паст"],
    ["Бальзам для волос 200 мл", "Бальзам для волос"],
    ["Хлеб «Нарочанский» 0,5 кг", "Хлеб нарочанский"],
    ["Яйца С1 10шт", "Яйца с1"],
    ["123", "123"],
  ])("«%s» → «%s»", (raw, normalized) => {
    expect(normalizeItemName(raw)).toBe(normalized);
  });
});
