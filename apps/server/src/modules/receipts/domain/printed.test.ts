// RCPT-03, RCPT-04: напечатанные значения чека разбирает код; неразобранное — undefined, а не догадка.
import { describe, expect, it } from "vitest";
import {
  parsePrintedDate,
  parsePrintedMoney,
  parsePrintedQuantity,
  parsePrintedTime,
  plainMoney,
  plainQuantity,
} from "./printed.ts";
import { uidFromQr } from "./qr.ts";

describe("RCPT-03: суммы, количество, день и время с чека", () => {
  it("сумма «2,49» и «2.49» — 249 копеек, «1 234,50» — 123 450", () => {
    expect(parsePrintedMoney("2,49", "BYN")?.minor).toBe(249);
    expect(parsePrintedMoney("2.49", "BYN")?.minor).toBe(249);
    expect(parsePrintedMoney("1 234,50", "BYN")?.minor).toBe(123_450);
  });

  it("не сумма — undefined", () => {
    expect(parsePrintedMoney("две", "BYN")).toBeUndefined();
    expect(parsePrintedMoney("2,499", "BYN")).toBeUndefined();
  });

  it("количество в тысячных: «3» → 3000, «0,345» → 345, «1.5» → 1500", () => {
    expect(parsePrintedQuantity("3")).toBe(3000);
    expect(parsePrintedQuantity("0,345")).toBe(345);
    expect(parsePrintedQuantity("1.5")).toBe(1500);
  });

  it("нулевое, отрицательное и с четырьмя знаками количество — undefined", () => {
    expect(parsePrintedQuantity("0")).toBeUndefined();
    expect(parsePrintedQuantity("-1")).toBeUndefined();
    expect(parsePrintedQuantity("0,3451")).toBeUndefined();
    expect(parsePrintedQuantity("несколько")).toBeUndefined();
  });

  it("день: «12.10.2026», «12.10.26» и «2026-10-12» — один и тот же день", () => {
    expect(parsePrintedDate("12.10.2026")).toBe("2026-10-12");
    expect(parsePrintedDate("12.10.26")).toBe("2026-10-12");
    expect(parsePrintedDate("2026-10-12")).toBe("2026-10-12");
    expect(parsePrintedDate("1/2/2026")).toBe("2026-02-01");
  });

  it("несуществующий день и не дата — undefined", () => {
    expect(parsePrintedDate("31.02.2026")).toBeUndefined();
    expect(parsePrintedDate("вчера")).toBeUndefined();
  });

  it("время «8:47» → 08:47:00, «21:05:09» остаётся, «25:00» — undefined", () => {
    expect(parsePrintedTime("8:47")).toBe("08:47:00");
    expect(parsePrintedTime("21:05:09")).toBe("21:05:09");
    expect(parsePrintedTime("25:00")).toBeUndefined();
    expect(parsePrintedTime("12:60")).toBeUndefined();
    expect(parsePrintedTime("полдень")).toBeUndefined();
  });

  it("описание перепроверке: копейки и количество — как на чеке", () => {
    expect(plainMoney(847)).toBe("8,47");
    expect(plainMoney(-5)).toBe("-0,05");
    expect(plainQuantity(3000)).toBe("3");
    expect(plainQuantity(345)).toBe("0,345");
    expect(plainQuantity(1500)).toBe("1,5");
  });
});

describe("RCPT-04: УИ из QR-кода", () => {
  it("сам УИ из 24 символов — в верхнем регистре", () => {
    expect(uidFromQr("a1b2c3d4e5f6a7b8c9d0e1f2")).toBe("A1B2C3D4E5F6A7B8C9D0E1F2");
  });

  it("УИ внутри ссылки находится", () => {
    expect(uidFromQr("https://example.test/check?uid=A1B2C3D4E5F6A7B8C9D0E1F2&d=12.10")).toBe(
      "A1B2C3D4E5F6A7B8C9D0E1F2",
    );
  });

  it("тот же УИ дважды — один УИ", () => {
    expect(uidFromQr("A1B2C3D4E5F6A7B8C9D0E1F2 a1b2c3d4e5f6a7b8c9d0e1f2")).toBe(
      "A1B2C3D4E5F6A7B8C9D0E1F2",
    );
  });

  it("два разных кандидата или ни одного — УИ неизвестен", () => {
    expect(uidFromQr("A1B2C3D4E5F6A7B8C9D0E1F2 Z1B2C3D4E5F6A7B8C9D0E1F2")).toBeUndefined();
    expect(uidFromQr("https://example.test")).toBeUndefined();
  });

  it("23 и 25 символов — не УИ", () => {
    expect(uidFromQr("A1B2C3D4E5F6A7B8C9D0E1F")).toBeUndefined();
    expect(uidFromQr("A1B2C3D4E5F6A7B8C9D0E1F2G")).toBeUndefined();
  });
});
