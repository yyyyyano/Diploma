// TAX-01…07: калькулятор вычетов — обучение (ст. 210), дети (ст. 209), жильё (ст. 211), оценка начисленного дохода (TAX-04).
// Каждый пример SPEC TAX-07 — отдельный тест; ставки и суммы входят в расчёт узлами со ссылками на норму, а не живут в коде.
import { Money } from "@kosht/kernel";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { node } from "../calc.ts";
import {
  childrenDeduction,
  educationDeduction,
  grossFromNet,
  housingDeduction,
  monthlyBase,
} from "./deductions.ts";

const byn = (minor: number) => Money.of(minor, "BYN");
const rubles = (value: number) => byn(value * 100);
const rate13 = node("tax.incomeRate", 1300, { refs: [{ kind: "fragmentVersion", id: "v-214" }] });
const rate1 = node("tax.fsznRate", 100);
const income = (value: Money) => node("tax.grossIncome", value);

describe("TAX-04: оценка начисленного дохода — «на руки» ÷ 0,86", () => {
  it("2 500,00 «на руки» → ≈ 2 906,98 начисленных (13 % налога и 1 % ФСЗН), в трассе — ставки и округление", () => {
    const gross = grossFromNet(node("tax.netIncome", rubles(2500)), rate13, rate1);
    expect(gross.value).toEqual(byn(290_698));
    expect(gross.trace.key).toBe("tax.grossEstimate");
    expect(gross.trace.inputs.map((input) => input.key)).toEqual([
      "tax.netIncome",
      "tax.incomeRate",
      "tax.fsznRate",
    ]);
    expect(gross.trace.note).toContain("rounding=half-up-kopeck");
  });

  it("ставки в сумме 100 % и больше — ошибка: делить не на что", () => {
    expect(() =>
      grossFromNet(node("tax.netIncome", rubles(100)), node("tax.incomeRate", 9900), rate1),
    ).toThrow(RangeError);
  });
});

describe("TAX-07, пример 1: обучение", () => {
  it("2 000 BYN → вычет 2 000, экономия 260,00 BYN (13 %); доход за год не указан — «до», остаток не известен", () => {
    const result = educationDeduction({
      paid: rubles(2000),
      rateBp: rate13,
      annualTaxable: null,
    });
    expect(result.deduction.value).toEqual(rubles(2000));
    expect(result.saving.value).toEqual(rubles(260));
    expect(result.upperBound).toBe(true);
    expect(result.carryOver).toBeNull();
  });

  it("облагаемый доход за год 34 884 больше оплаты — экономия 260 и остаток переноса 0", () => {
    const result = educationDeduction({
      paid: rubles(2000),
      rateBp: rate13,
      annualTaxable: income(rubles(34_884)),
    });
    expect(result.saving.value).toEqual(rubles(260));
    expect(result.upperBound).toBe(false);
    expect(result.carryOver?.value).toEqual(rubles(0));
  });

  it("облагаемого дохода за год 1 500 меньше оплаты 2 000: экономия 195,00, остаток 500 переносится на следующие годы (TAX-05)", () => {
    const result = educationDeduction({
      paid: rubles(2000),
      rateBp: rate13,
      annualTaxable: income(rubles(1500)),
    });
    expect(result.saving.value).toEqual(rubles(195));
    expect(result.carryOver?.value).toEqual(rubles(500));
    expect(result.carryOver?.trace.key).toBe("tax.education.carryOver");
  });

  it("доход за год ноль — вернуть нечего, весь вычет переносится", () => {
    const result = educationDeduction({
      paid: rubles(2000),
      rateBp: rate13,
      annualTaxable: income(rubles(0)),
    });
    expect(result.saving.value).toEqual(rubles(0));
    expect(result.carryOver?.value).toEqual(rubles(2000));
  });

  it("оплата не больше нуля — ошибка", () => {
    expect(() =>
      educationDeduction({ paid: rubles(0), rateBp: rate13, annualTaxable: null }),
    ).toThrow(RangeError);
  });
});

describe("TAX-07, пример 3: двое детей", () => {
  const perChild = node("tax.children.perChild", rubles(120));

  it("120 × 2 = 240 BYN вычета в месяц, экономия 31,20 BYN в месяц и 374,40 BYN в год", () => {
    const result = childrenDeduction({
      children: 2,
      perChild,
      rateBp: rate13,
      monthlyIncome: null,
    });
    expect(result.deductionMonthly.value).toEqual(rubles(240));
    expect(result.savingMonthly.value).toEqual(byn(3120));
    expect(result.savingYearly.value).toEqual(byn(37_440));
    expect(result.upperBound).toBe(true);
  });

  it("зарплата 150 меньше вычета 240: вернуть можно не больше налога с 150 — 19,50 BYN в месяц (TAX-05)", () => {
    const result = childrenDeduction({
      children: 2,
      perChild,
      rateBp: rate13,
      monthlyIncome: income(rubles(150)),
    });
    expect(result.savingMonthly.value).toEqual(byn(1950));
    expect(result.upperBound).toBe(false);
  });

  it("зарплата выше вычета — экономия полная и не «до»", () => {
    const result = childrenDeduction({
      children: 2,
      perChild,
      rateBp: rate13,
      monthlyIncome: income(rubles(2500)),
    });
    expect(result.savingMonthly.value).toEqual(byn(3120));
    expect(result.upperBound).toBe(false);
  });

  it("детей нет — ошибка: вычета на детей нет, считать нечего", () => {
    expect(() =>
      childrenDeduction({ children: 0, perChild, rateBp: rate13, monthlyIncome: null }),
    ).toThrow(RangeError);
  });
});

describe("TAX-07, пример 2: квартира 120 000 BYN", () => {
  const noStandard = node("tax.standardMonthly", rubles(0));

  it("экономия до 15 600,00 BYN; при начисленной зарплате 2 500 без других вычетов — 48 месяцев, помесячный план без остатка", () => {
    const result = housingDeduction({
      expenses: rubles(120_000),
      rateBp: rate13,
      monthlyGross: income(rubles(2500)),
      standardMonthly: noStandard,
    });
    expect(result.totalSaving.value).toEqual(rubles(15_600));
    expect(result.term?.months.value).toBe(48);
    expect(result.term?.approx).toBe(false);
    expect(result.term?.fullMonths.value).toBe(48);
    expect(result.term?.lastMonth.value).toEqual(rubles(0));
    expect(result.term?.monthlySaving.value).toEqual(rubles(325));
    expect(result.term?.months.trace.inputs.map((input) => input.key)).toEqual([
      "tax.housing.expenses",
      "tax.housing.monthlyBase",
      "tax.housing.fullMonths",
      "tax.housing.lastMonth",
    ]);
  });

  it("2 500 «на руки» → начисленная ≈ 2 906,98 → ≈ 41 месяц: 41 полный и последний неполный на 813,82", () => {
    const gross = grossFromNet(node("tax.netIncome", rubles(2500)), rate13, rate1);
    const result = housingDeduction({
      expenses: rubles(120_000),
      rateBp: rate13,
      monthlyGross: gross,
      standardMonthly: noStandard,
    });
    expect(result.term?.months.value).toBe(41);
    expect(result.term?.approx).toBe(true);
    expect(result.term?.fullMonths.value).toBe(41);
    expect(result.term?.lastMonth.value).toEqual(byn(81_382));
  });

  it("стандартный вычет применяется раньше имущественного и удлиняет срок: 2 500 − 240 = 2 260 в месяц → ≈ 53 месяца", () => {
    const result = housingDeduction({
      expenses: rubles(120_000),
      rateBp: rate13,
      monthlyGross: income(rubles(2500)),
      standardMonthly: node("tax.standardMonthly", rubles(240)),
    });
    expect(result.term?.monthlyBase.value).toEqual(rubles(2260));
    expect(result.term?.months.value).toBe(53);
    expect(result.term?.approx).toBe(true);
  });

  it("половина месяца округляется вверх: 41,5 → «≈ 42»", () => {
    const result = housingDeduction({
      expenses: rubles(83),
      rateBp: rate13,
      monthlyGross: income(rubles(2)),
      standardMonthly: node("tax.standardMonthly", rubles(0)),
    });
    expect(result.term?.months.value).toBe(42);
    expect(result.term?.approx).toBe(true);
  });

  it("зарплата не известна — срока нет, но общая сумма «до 15 600» есть", () => {
    const result = housingDeduction({
      expenses: rubles(120_000),
      rateBp: rate13,
      monthlyGross: null,
      standardMonthly: noStandard,
    });
    expect(result.totalSaving.value).toEqual(rubles(15_600));
    expect(result.term).toBeNull();
    expect(result.termReason).toBe("no-income");
  });

  it("зарплата целиком уходит на стандартные вычеты — уменьшать нечего, срока нет", () => {
    const result = housingDeduction({
      expenses: rubles(120_000),
      rateBp: rate13,
      monthlyGross: income(rubles(240)),
      standardMonthly: node("tax.standardMonthly", rubles(240)),
    });
    expect(result.term).toBeNull();
    expect(result.termReason).toBe("no-taxable");
  });
});

describe("monthlyBase: доход минус стандартные вычеты, не меньше нуля", () => {
  it("1 300 − 216 = 1 084; меньше вычетов — ноль", () => {
    const standard = node("tax.standardMonthly", rubles(216));
    expect(monthlyBase(income(rubles(1300)), standard).value).toEqual(rubles(1084));
    expect(monthlyBase(income(rubles(100)), standard).value).toEqual(rubles(0));
  });
});

describe("свойства расчёта вычетов (fast-check)", () => {
  const money = (max: number) => fc.integer({ min: 1, max }).map(byn);

  it("жильё: полные месяцы × база + последний неполный = расходы; последний меньше базы", () => {
    fc.assert(
      fc.property(money(50_000_000), money(5_000_000), (expenses, gross) => {
        const result = housingDeduction({
          expenses,
          rateBp: rate13,
          monthlyGross: income(gross),
          standardMonthly: node("tax.standardMonthly", byn(0)),
        });
        const term = result.term;
        expect(term).not.toBeNull();
        if (term === null) return;
        const full = BigInt(term.fullMonths.value) * BigInt(gross.minor);
        expect(full + BigInt(term.lastMonth.value.minor)).toBe(BigInt(expenses.minor));
        expect(term.lastMonth.value.minor).toBeLessThan(gross.minor);
      }),
    );
  });

  it("обучение: использованное + остаток = оплата, экономия не больше оплаты × ставку", () => {
    fc.assert(
      fc.property(money(100_000_000), fc.integer({ min: 0, max: 200_000_000 }), (paid, annual) => {
        const result = educationDeduction({
          paid,
          rateBp: rate13,
          annualTaxable: income(byn(annual)),
        });
        const used = Math.min(paid.minor, annual);
        expect(result.carryOver?.value.minor).toBe(paid.minor - used);
        expect(result.saving.value.minor).toBeLessThanOrEqual(
          Math.ceil((paid.minor * 1300) / 10_000),
        );
      }),
    );
  });

  it("дети: экономия в месяц не больше налога с дохода и не убывает с числом детей", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), money(3_000_000), (children, gross) => {
        const run = (count: number) =>
          childrenDeduction({
            children: count,
            perChild: node("tax.children.perChild", rubles(120)),
            rateBp: rate13,
            monthlyIncome: income(gross),
          }).savingMonthly.value.minor;
        expect(run(children)).toBeLessThanOrEqual(Math.ceil((gross.minor * 1300) / 10_000));
        expect(run(children + 1)).toBeGreaterThanOrEqual(run(children));
      }),
    );
  });
});
