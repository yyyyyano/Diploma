// STMT-04, STMT 9.7: шапка банка — что есть, то найдено; чего нет — не выдумано.
import { describe, expect, it } from "vitest";
import { readPreamble } from "./preamble.ts";

describe("STMT-04: шапка выписки", () => {
  it("банк, карта, период и остатки из строк шапки", () => {
    expect(
      readPreamble([
        "Лесбанк",
        "Выписка по карте ****4821",
        "Период: 01.09.2026 - 30.09.2026",
        "Остаток на начало: 1 000,00",
        "Остаток на конец: 5 323,22",
      ]),
    ).toEqual({
      bank: "Лесбанк",
      accountMask: "4821",
      period: { from: "2026-09-01", to: "2026-09-30" },
      openingMinor: 100_000,
      closingMinor: 532_322,
    });
  });

  it("IBAN — маска из последних четырёх знаков; «Банк: …» и валюта счёта", () => {
    expect(
      readPreamble(["Банк: Пущабанк", "Счёт: BY00KOSH30130000000000001234", "Валюта счёта: BYN"]),
    ).toEqual({ bank: "Пущабанк", accountMask: "1234", currency: "BYN" });
  });

  it("английская шапка: Bank, Account ****7788, Currency USD, Opening balance 1,234.50", () => {
    expect(
      readPreamble([
        "Bank: Hamlet Bank",
        "Account: ****7788",
        "Currency: USD",
        "Opening balance: 1,234.50",
      ]),
    ).toEqual({
      bank: "Hamlet Bank",
      accountMask: "7788",
      currency: "USD",
      openingMinor: 123_450,
    });
  });

  it("отрицательный остаток с U+2212 и «Входящий/Исходящий остаток»", () => {
    expect(readPreamble(["Входящий остаток: −150,00", "Исходящий остаток: 20,00"])).toEqual({
      openingMinor: -15_000,
      closingMinor: 2_000,
    });
  });

  it("пустая шапка и посторонние строки — пустой результат, а не догадки", () => {
    expect(readPreamble([])).toEqual({});
    expect(readPreamble(["Выписка по счёту", "Дата формирования 01.10.2026"])).toEqual({});
  });
});
