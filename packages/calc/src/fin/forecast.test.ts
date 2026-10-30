// FIN-22: прогноз остатка по дням — остатки + ожидаемые поступления − ожидаемые платежи, каждый день с трассой.
import { LocalDate, Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { node } from "../calc.ts";
import { forecastBalances } from "./forecast.ts";

const d = (text: string) => LocalDate.parse(text);
const byn = (minor: number) => Money.of(minor, "BYN");

describe("FIN-22: прогноз остатка по дням", () => {
  const days = forecastBalances({
    from: d("2026-10-28"),
    to: d("2026-10-31"),
    start: node("accounts.available", byn(100_000)),
    incomes: [{ on: d("2026-10-30"), amount: node("fin.expectedIncome", byn(144_000)) }],
    payments: [
      { on: d("2026-10-29"), amount: node("fin.expectedPayment", byn(41_000)) },
      { on: d("2026-10-31"), amount: node("fin.expectedPayment", byn(3_290)) },
    ],
  });

  it("по дню на каждый день включительно", () => {
    expect(days.map((day) => day.on)).toEqual([
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
  });

  it("остаток = старт + поступления до дня − платежи до дня: 1 000 → 590 → 2 030 → 1 997,10", () => {
    expect(days.map((day) => day.balance.value.minor)).toEqual([100_000, 59_000, 203_000, 199_710]);
  });

  it("в трассе дня — остаток, поступление и платёж своими ключами", () => {
    const keys = JSON.stringify(days[3]?.balance.trace);
    expect(keys).toContain("fin.expectedIncome");
    expect(keys).toContain("fin.expectedPayment");
    expect(keys).toContain("accounts.available");
  });

  it("без ожидаемых — остаток не меняется; через границу месяца дни идут подряд", () => {
    const flat = forecastBalances({
      from: d("2026-02-27"),
      to: d("2026-03-01"),
      start: node("accounts.available", byn(500)),
      incomes: [],
      payments: [],
    });
    expect(flat.map((day) => day.on)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(flat.every((day) => day.balance.value.minor === 500)).toBe(true);
  });
});
