// AGT-04, P1: числа ответа сверяются с результатами инструментов по точному значению: «15», «15,00» и 1500 копеек —
// одно число; выдуманное «1 234,56» — нет.
import { describe, expect, it } from "vitest";
import { extractNumbers, fromNumber, NumberLedger } from "./numbers.ts";

describe("extractNumbers: что в тексте считается числом", () => {
  it.each([
    ["Потрачено 15 BYN", ["15"]],
    ["Потрачено 15,00 BYN", ["15"]],
    ["Итого 1 234,56 BYN", ["1234.56"]],
    ["Итого 1 234,56 BYN", ["1234.56"]],
    ["Итого 1234.50 BYN", ["1234.5"]],
    ["Минус −840,00 BYN", ["840"]],
    ["Доля 23 % от трат", ["23"]],
    ["Три покупки и ни одной цифры", []],
  ])("«%s»", (text, expected) => {
    expect(extractNumbers(text)).toEqual(expected);
  });

  it("номера норм не считаются: «ст. 210», «п. 1.1», «статьи 209.1», «№ 5»", () => {
    expect(extractNumbers("По ст. 210 НК и п. 1.1 статьи 209.1, а также № 5")).toEqual([]);
  });

  it("нумерация списка и порядковые окончания не считаются", () => {
    expect(extractNumbers("1. Первое\n2) Второе\nквартира 2-х комнатная")).toEqual([]);
  });

  it("даты и время — числа по отдельности", () => {
    expect(extractNumbers("С 31.10.2026 в 14:37; в 2026-09-01")).toEqual([
      "31",
      "10",
      "2026",
      "14",
      "37",
      "2026",
      "9",
      "1",
    ]);
  });

  it("числа внутри слов и ссылок — не числа: A4, https://pravo.by/x?p=123", () => {
    expect(extractNumbers("Формат A4, ссылка https://pravo.by/doc?p0=123")).toEqual([]);
  });
});

describe("fromNumber: копейки и рубли", () => {
  it("1500 копеек — «1500» и «15»; 123456 — «1234.56»", () => {
    expect(fromNumber(1500)).toEqual(["1500", "15"]);
    expect(fromNumber(123_456)).toEqual(["123456", "1234.56"]);
  });

  it("5 копеек — «0.05»; отрицательное — по модулю; не целое — как есть", () => {
    expect(fromNumber(5)).toEqual(["5", "0.05"]);
    expect(fromNumber(-840_00)).toEqual(["84000", "840"]);
    expect(fromNumber(12.5)).toEqual(["12.5"]);
  });

  it("бесконечность и запись с порядком — без чисел", () => {
    expect(fromNumber(Number.POSITIVE_INFINITY)).toEqual([]);
    expect(fromNumber(1e21)).toEqual([]);
  });
});

describe("NumberLedger: разрешённые числа ответа", () => {
  const ledger = new NumberLedger();
  ledger.addJson({
    total: { minor: 123_456, currency: "BYN" },
    items: [{ percent: 23, date: "2026-09-01", text: "23,46 %" }],
    nothing: null,
  });
  ledger.addText("Потратил 15 рублей на кофе");

  it("сумма в копейках разрешает рубли: 1 234,56 и «1234,56»", () => {
    expect(ledger.unverified("Вы потратили 1 234,56 BYN")).toEqual([]);
    expect(ledger.unverified("Вы потратили 1234,56")).toEqual([]);
  });

  it("выдуманное «1 235,56» не проходит и названо", () => {
    expect(ledger.unverified("Вы потратили 1 235,56 BYN")).toEqual(["1235.56"]);
  });

  it("числа из сообщения пользователя и из строк результата разрешены", () => {
    expect(ledger.unverified("15 рублей, 23 %, 2026 год")).toEqual([]);
  });

  it("номер нормы из вопроса можно повторить, чужой — нет", () => {
    const withNorm = new NumberLedger();
    withNorm.addText("Что сказано в ст. 210?");
    expect(withNorm.unverified("Смотрите ст. 210 и 212")).toEqual(["212"]);
  });

  it("повторы схлопываются, порядок — как в тексте", () => {
    expect(ledger.unverified("99, потом 77 и снова 99")).toEqual(["99", "77"]);
  });

  it("значение графика: копейки результата подходят, чужое число — нет", () => {
    expect(ledger.hasValue(123_456)).toBe(true);
    expect(ledger.hasValue(777)).toBe(false);
  });

  it("слишком глубокая вложенность и undefined не ломают набор", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 30; i += 1) {
      const next: Record<string, unknown> = {};
      cursor["x"] = next;
      cursor = next;
    }
    cursor["n"] = 424_242;
    const l = new NumberLedger();
    l.addJson(deep);
    l.addJson(undefined);
    expect(l.has("424242")).toBe(false);
  });
});
