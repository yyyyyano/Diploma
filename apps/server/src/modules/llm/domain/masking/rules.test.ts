// PRIV-03: правила маскирования — что находится и, не менее важно, что остаётся (суммы, даты, магазины). Все данные
// синтетические (NFR-18): номера — обычные тестовые, не чьи-то настоящие.
import { describe, expect, it } from "vitest";
import { detectByRules, ibanChecksumOk, luhnOk, resolveOverlaps } from "./rules.ts";

function found(text: string): { kind: string; text: string }[] {
  return resolveOverlaps(detectByRules(text)).map((span) => ({
    kind: span.kind,
    text: text.slice(span.start, span.end),
  }));
}

describe("PRIV-03: IBAN и счета", () => {
  it("белорусский IBAN с пробелами и без — целиком, даже при неверной контрольной сумме", () => {
    expect(found("Счёт BY20 AKBB 3012 0000 0418 8000 0000 пополнен")).toEqual([
      { kind: "iban", text: "BY20 AKBB 3012 0000 0418 8000 0000" },
    ]);
    expect(found("BY20AKBB30120000041880000000")).toEqual([
      { kind: "iban", text: "BY20AKBB30120000041880000000" },
    ]);
    expect(found("перевод на BY00 XXXX 1234 5678 9012 3456 7890 сегодня")).toHaveLength(1);
  });

  it("лишняя группа справа не входит в счёт: считается ровно 28 знаков", () => {
    expect(found("BY20 AKBB 3012 0000 0418 8000 0000 1234")).toEqual([
      { kind: "iban", text: "BY20 AKBB 3012 0000 0418 8000 0000" },
    ]);
  });

  it("чужая страна — только с верной контрольной суммой", () => {
    expect(ibanChecksumOk("DE89370400440532013000")).toBe(true);
    expect(found("IBAN DE89 3704 0044 0532 0130 00")).toEqual([
      { kind: "iban", text: "DE89 3704 0044 0532 0130 00" },
    ]);
    expect(found("код AB12 CDEF 0000 1111 2222")).toEqual([]);
  });
});

describe("PRIV-03: номера карт", () => {
  it("с пробелами, дефисами и слитно — только если сходится алгоритм Луна", () => {
    expect(luhnOk("4111111111111111")).toBe(true);
    expect(found("Карта 4111 1111 1111 1111 списание")).toEqual([
      { kind: "card", text: "4111 1111 1111 1111" },
    ]);
    expect(found("4111-1111-1111-1111")).toHaveLength(1);
    expect(found("4111111111111111")).toHaveLength(1);
  });

  it("длинное число без контрольной суммы и обычная сумма — не карта", () => {
    expect(found("номер 4111 1111 1111 1112")).toEqual([]);
    expect(found("Итого 1 234,56 BYN, чек 8,47")).toEqual([]);
  });
});

describe("PRIV-03: телефоны и email", () => {
  it.each([
    "+375 (29) 123-45-67",
    "+375291234567",
    "375 29 1234567",
    "8 029 123-45-67",
    "+7 495 123-45-67",
  ])("телефон «%s»", (phone) => {
    expect(found(`звоните ${phone} в будни`)).toEqual([{ kind: "phone", text: phone }]);
  });

  it("даты, суммы и номера чеков — не телефон", () => {
    expect(found("21.10.2026 18:45, 1234567, сумма 20,00")).toEqual([]);
  });

  it("email с кириллицей и плюсом", () => {
    expect(found("пишите ivan.petrov+bank@example.by или иван@почта.рф")).toEqual([
      { kind: "email", text: "ivan.petrov+bank@example.by" },
      { kind: "email", text: "иван@почта.рф" },
    ]);
  });
});

describe("PRIV-03: паспорт", () => {
  it("идентификационный номер и серия с номером", () => {
    expect(found("ИН 3150384A001PB5, паспорт KB1234567")).toEqual([
      { kind: "passport", text: "3150384A001PB5" },
      { kind: "passport", text: "KB1234567" },
    ]);
  });
});

describe("PRIV-03: адреса", () => {
  it.each([
    "г. Минск, ул. Притыцкого, д. 156, кв. 45",
    "ул. Немига 5",
    "пр-т Независимости, 11",
    "аг. Ратомка, ул. Школьная, д. 3",
  ])("адрес «%s»", (address) => {
    expect(found(`Доставка: ${address} позвонить заранее`)).toEqual([
      { kind: "address", text: address },
    ]);
  });

  it("слово «улица» без названия и магазин — не адрес", () => {
    expect(found("Магазин «Евроопт», оплата картой")).toEqual([]);
    expect(found("улица была мокрой")).toEqual([]);
  });
});

describe("пересечения", () => {
  it("телефон внутри счёта не маскируется отдельно: остаётся сильнейший отрезок", () => {
    const text = "BY20 AKBB 3012 0000 0418 8000 0000";
    expect(found(text)).toEqual([{ kind: "iban", text }]);
  });
});
