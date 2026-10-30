// REC-02, REC-04, FIN-20: средняя сумма регулярного платежа по операциям-основаниям, пересчёт в месяц и итог раздела.
import { Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import { node } from "../calc.ts";
import { monthlyAmount, monthlyTotal, recurringAverage } from "./recurring-amounts.ts";

const byn = (minor: number) => Money.of(minor, "BYN");

describe("REC-02: средняя сумма", () => {
  it("ЖКХ июль–сентябрь 172,10 + 185,70 + 201,40 → 186,40; основания — операции", () => {
    const result = recurringAverage([
      { id: "tx-jul", amount: byn(17_210) },
      { id: "tx-aug", amount: byn(18_570) },
      { id: "tx-sep", amount: byn(20_140) },
    ]);
    expect(result.value).toEqual(byn(18_640));
    expect(result.trace).toMatchObject({
      key: "recurring.averageAmount",
      op: "avg",
      inputs: [
        { key: "recurring.occurrence", refs: [{ kind: "transaction", id: "tx-jul" }] },
        { key: "recurring.occurrence", refs: [{ kind: "transaction", id: "tx-aug" }] },
        { key: "recurring.occurrence", refs: [{ kind: "transaction", id: "tx-sep" }] },
      ],
    });
  });

  it("среднее округляется явно, половина копейки — вверх", () => {
    const result = recurringAverage([
      { id: "a", amount: byn(1_000) },
      { id: "b", amount: byn(1_001) },
    ]);
    expect(result.value).toEqual(byn(1_001));
    expect(result.trace.note).toBe("rounding=half-up-kopeck step=1");
  });
});

describe("REC-04: сумма в месяц", () => {
  const average = (minor: number) => node("recurring.averageAmount", byn(minor));

  it("ежемесячный платёж остаётся как есть", () => {
    expect(monthlyAmount(average(41_000), "month").value).toEqual(byn(41_000));
  });

  it("ежеквартальный 300,00 → 100,00 в месяц", () => {
    expect(monthlyAmount(average(30_000), "quarter").value).toEqual(byn(10_000));
  });

  it("ежегодный 461,64 → 38,47 в месяц", () => {
    expect(monthlyAmount(average(46_164), "year").value).toEqual(byn(3_847));
  });

  it("еженедельный 10,00 → 43,33 в месяц (52 недели ÷ 12 месяцев)", () => {
    const result = monthlyAmount(average(1_000), "week");
    expect(result.value).toEqual(byn(4_333));
    expect(result.trace).toMatchObject({ key: "recurring.monthlyAmount", op: "mul" });
  });
});

describe("FIN-20: итог раздела", () => {
  it("складывает суммы в месяц; пустой раздел — ноль BYN", () => {
    const parts = [
      node("recurring.monthlyAmount", byn(41_000)),
      node("recurring.monthlyAmount", byn(18_640)),
    ];
    expect(monthlyTotal("recurring.monthlyTotal", parts).value).toEqual(byn(59_640));
    expect(monthlyTotal("recurring.monthlyTotal", []).value).toEqual(byn(0));
  });
});
