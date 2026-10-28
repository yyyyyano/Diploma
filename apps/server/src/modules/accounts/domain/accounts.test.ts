// STMT-01, STMT-02, STMT-09, RCPT-10: служебные счета, сдвиг остатка, итоги в BYN по курсу НБРБ.
import { Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { balanceInByn, isProtected, isSavings, shiftBalance, totalInByn } from "./accounts.ts";

const USD = { currency: "USD", rateE4: 29_871, scale: 1, id: "fx-usd" };
const account = (kind: string, currency: string, balanceMinor: number) => ({
  kind,
  currency,
  balanceMinor,
});

describe("STMT-01, RCPT-10: служебные счета не удаляются", () => {
  it("«Наличные» в BYN и «Карта, не указана» защищены, наличные в USD и карта — нет", () => {
    expect(isProtected({ kind: "cash", currency: "BYN" })).toBe(true);
    expect(isProtected({ kind: "unknown-card", currency: "BYN" })).toBe(true);
    expect(isProtected({ kind: "cash", currency: "USD" })).toBe(false);
    expect(isProtected({ kind: "card", currency: "BYN" })).toBe(false);
  });

  it("накопительный и вклад — отложенные деньги", () => {
    expect(["savings", "deposit", "card", "cash"].map(isSavings)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("STMT-01: начальный остаток", () => {
  it("был 0, стал 150,00 — остаток 40,00 (после трат) становится 190,00", () => {
    expect(
      shiftBalance(Money.of(4_000, "BYN"), Money.of(0, "BYN"), Money.of(15_000, "BYN")),
    ).toEqual({ minor: 19_000, currency: "BYN" });
  });
});

describe("STMT-09: итоги в BYN", () => {
  it("1 284,37 BYN + 320,00 USD по 2,9871 → 2 240,24 BYN; BYN-счёт — как есть", () => {
    const items = [account("card", "BYN", 128_437), account("card", "USD", 32_000)];
    const total = totalInByn("accounts.total", items, new Map([["USD", USD]]));
    expect(total?.value).toEqual({ minor: 128_437 + 95_587, currency: "BYN" });
    expect(total?.trace.key).toBe("accounts.total");
    expect(balanceInByn(items[0]!, undefined)?.value).toEqual({ minor: 128_437, currency: "BYN" });
  });

  it("курса USD нет — итог не показывается (undefined), а не 0", () => {
    const items = [account("cash", "BYN", 100), account("card", "USD", 1)];
    expect(totalInByn("accounts.total", items, new Map())).toBeUndefined();
    expect(balanceInByn(items[1]!, undefined)).toBeUndefined();
  });

  it("счетов нет — 0,00 BYN", () => {
    expect(totalInByn("accounts.available", [], new Map())?.value).toEqual({
      minor: 0,
      currency: "BYN",
    });
  });
});
