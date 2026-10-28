// STMT-09, КП STMT: операция в USD показывает сумму в BYN по курсу НБРБ на дату, курс виден в «Откуда эта цифра?».
import { Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { node } from "../calc.ts";
import { toByn } from "./to-byn.ts";

const usd = (minor: number) => node("accounts.balance", Money.of(minor, "USD"));
const USD_RATE = { currency: "USD", rateE4: 29_871, scale: 1, id: "fx-usd-2026-10-21" };

describe("STMT-09: эквивалент в BYN по курсу НБРБ", () => {
  it("320,00 USD по 2,9871 → 955,87 BYN; курс и масштаб — в трассе со ссылкой на курс", () => {
    const result = toByn("accounts.balanceInByn", usd(32_000), USD_RATE);
    expect(result.value).toEqual({ minor: 95_587, currency: "BYN" });
    expect(result.trace).toMatchObject({
      key: "accounts.balanceInByn",
      op: "mul",
      inputs: [
        { key: "accounts.balance", value: { minor: 32_000, currency: "USD" } },
        { key: "fx.rate", value: 29_871, refs: [{ kind: "fxRate", id: "fx-usd-2026-10-21" }] },
        { key: "fx.scale", value: 1 },
      ],
      note: "rounding=half-up-kopeck step=1",
    });
  });

  it("RUB — курс за 100 единиц: 1 000,00 RUB по 3,6432 за 100 → 36,43 BYN", () => {
    const rub = node("accounts.balance", Money.of(100_000, "RUB"));
    const result = toByn("x", rub, { currency: "RUB", rateE4: 36_432, scale: 100, id: "fx-rub" });
    expect(result.value).toEqual({ minor: 3_643, currency: "BYN" });
  });

  it("половина копейки — от нуля, и для отрицательного остатка тоже", () => {
    // 0,01 USD × 2,5 = 0,025 BYN → 0,03; −0,01 → −0,03.
    const rate = { currency: "USD", rateE4: 25_000, scale: 1, id: "r" };
    expect(toByn("x", usd(1), rate).value.minor).toBe(3);
    expect(toByn("x", usd(-1), rate).value.minor).toBe(-3);
  });

  it("BYN не пересчитывается — та же трасса", () => {
    const byn = node("accounts.balance", Money.of(18_650, "BYN"));
    expect(toByn("x", byn, USD_RATE)).toBe(byn);
  });

  it("курс другой валюты или неположительный — ошибка программы", () => {
    expect(() => toByn("x", usd(1), { ...USD_RATE, currency: "EUR" })).toThrow(RangeError);
    expect(() => toByn("x", usd(1), { ...USD_RATE, rateE4: 0 })).toThrow(RangeError);
    expect(() => toByn("x", usd(1), { ...USD_RATE, scale: 0 })).toThrow(RangeError);
  });
});
