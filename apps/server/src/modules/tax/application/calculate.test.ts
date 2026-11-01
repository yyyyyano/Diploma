// TAX-01…07, TAX-02, TAX-04, TAX-05: сценарий расчёта вычета по ветвям — без БД, с подставными фасадами соседей (профиль, таблица
// ставок, explain). Сквозь настоящие модули и HTTP — `main/tax.int.test.ts`.
import type { EmploymentType, FamilyStatus, ProfileFact } from "@kosht/contract";
import { Money, TraceId } from "@kosht/kernel";
import { FakeClock, testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { makeCalculate, type CalculateDeps } from "./calculate.ts";

const TODAY = "2026-11-01T09:00:00Z";
const byn = (value: number) => Money.of(value * 100, "BYN");

/** Подтверждённые значения 2026 года (как после миграций); `drop` убирает параметр — «нет подтверждённого значения». */
const RATES: Record<string, { value: number; unit: "byn-minor" | "percent-bp" }> = {
  "ndfl.rate.base": { value: 1300, unit: "percent-bp" },
  "ndfl.rate.high-from": { value: 35_000_000, unit: "byn-minor" },
  "ip.rate.base": { value: 2000, unit: "percent-bp" },
  "ip.rate.high-from": { value: 50_000_000, unit: "byn-minor" },
  "fszn.employee-rate": { value: 100, unit: "percent-bp" },
  "ndfl.std-deduction.base": { value: 21_600, unit: "byn-minor" },
  "ndfl.std-deduction.base-income-limit": { value: 130_800, unit: "byn-minor" },
  "ndfl.std-deduction.child": { value: 6300, unit: "byn-minor" },
  "ndfl.std-deduction.child-increased": { value: 12_000, unit: "byn-minor" },
};

const fact = (value: ProfileFact["value"], evaluation: ProfileFact["evaluation"] = null) =>
  ({
    id: "019e0000-0000-7000-8000-000000000001",
    topic: "other",
    value,
    source: "chat",
    sourceRef: null,
    status: "confirmed",
    recordedOn: "2026-10-01",
    evaluation,
  }) as ProfileFact;

const employment = (...types: EmploymentType[]) => fact({ key: "employment", types });
const familyStatus = (...statuses: FamilyStatus[]) => fact({ key: "familyStatus", statuses });
const children = (ages: number[], disabled: number[] = []) =>
  fact(
    {
      key: "children",
      children: ages.map((age, index) => ({
        name: null,
        birthDate: null,
        age,
        disability: disabled.includes(index),
        ageOn: "2026-10-01" as never,
      })),
    },
    {
      onDate: "2026-11-01" as never,
      childAges: ages,
      childrenUnder18: ages.filter((a) => a < 18).length,
    },
  );
const money = (key: "income.gross" | "income.salary" | "income.regular", value: number) =>
  fact({ key, amount: byn(value) });

function setup(facts: ProfileFact[] = [], drop: readonly string[] = []) {
  const saved: unknown[] = [];
  const deps: CalculateDeps = {
    clock: new FakeClock(TODAY),
    profile: { getFacts: async (_s, keys) => facts.filter((f) => keys.includes(f.value.key)) },
    normTables: {
      rate: async (param) => {
        const rate = RATES[param];
        if (rate === undefined || drop.includes(param)) {
          return { found: false, reason: "unconfirmed" };
        }
        return {
          found: true,
          param,
          unit: rate.unit,
          value: rate.value,
          validFrom: "2026-01-01",
          validTo: "2026-12-31",
          source: { act: "Hk0900071", article: "214", point: "1.1", url: null },
          confirmedBy: "developer",
          confirmedOn: "2026-11-01",
          versionId: "019e1111-0000-7000-8000-000000000001",
        };
      },
    },
    explain: {
      saveMany: async (_s, calcs) => {
        saved.push(...calcs);
        return calcs.map((_calc, index) =>
          TraceId.parse(`019e2222-0000-7000-8000-${String(index).padStart(12, "0")}`),
        );
      },
    },
    legalBase: {
      search: async () => ({
        mode: "hybrid",
        justAdded: false,
        cards: [],
        vectors: false,
        fragments: [],
      }),
    },
    legalConsult: {
      finalizeAnswer: async () => {
        throw new Error("без найденной нормы цитату не просят");
      },
    },
  };
  const s = { scope: testScope({ user: 1, household: 1 }) } as unknown as ScopedDb;
  return { calculate: makeCalculate(deps), s, saved };
}

describe("TAX-07, пример 1: обучение", () => {
  it("2 000 BYN, дохода за год нет — до 260,00 BYN, ставка 13, сумма «до», у каждого числа свой traceId", async () => {
    const { calculate, s, saved } = setup([employment("employee")]);
    const result = await calculate(s, { kind: "education", paid: byn(2000) });
    expect(result).toMatchObject({
      status: "ok",
      ratePercent: 13,
      year: 2026,
      checklistId: "deduction-education",
      ways: ["employer", "tax-office"],
    });
    expect(result.savingTotal?.amount).toEqual(byn(260));
    expect(result.savingYear?.amount).toEqual(byn(260));
    expect(result.deduction?.amount).toEqual(byn(2000));
    expect(result.carryOver).toBeNull();
    expect(result.flags).toEqual(["upper-bound", "ask-gross"]);
    expect(saved).toHaveLength(3);
    expect(new Set([result.deduction?.traceId, result.savingYear?.traceId]).size).toBe(2);
  });

  it("облагаемый доход за год 1 500 меньше оплаты — 195,00 BYN, остаток 500,00 переносится, «до» нет", async () => {
    const { calculate, s } = setup([employment("employee")]);
    const result = await calculate(s, {
      kind: "education",
      paid: byn(2000),
      annualTaxable: byn(1500),
    });
    expect(result.savingTotal?.amount).toEqual(byn(195));
    expect(result.carryOver?.amount).toEqual(byn(500));
    expect(result.flags).toEqual([]);
  });

  it("зарплата начислена 2 500 в профиле — доход за год считается из неё: 2 500 × 12 = 30 000 больше оплаты", async () => {
    const { calculate, s } = setup([employment("employee"), money("income.gross", 2500)]);
    const result = await calculate(s, { kind: "education", paid: byn(2000) });
    expect(result.savingTotal?.amount).toEqual(byn(260));
    expect(result.carryOver).toBeNull();
    expect(result.flags).toEqual([]);
  });
});

describe("TAX-07, пример 3: дети (PROF-06)", () => {
  it("двое детей 17 и 9 лет — повышенный вычет 120 × 2 = 240 в месяц, 31,20 в месяц, 374,40 в год", async () => {
    const { calculate, s } = setup([employment("employee"), children([17, 9])]);
    const result = await calculate(s, { kind: "children" });
    expect(result.deduction?.amount).toEqual(byn(240));
    expect(result.savingMonthly?.amount).toEqual(Money.of(3120, "BYN"));
    expect(result.savingYear?.amount).toEqual(Money.of(37_440, "BYN"));
    expect(result.children).toEqual({ count: 2, increased: true });
    expect(result.ways).toEqual(["employer"]);
    expect(result.checklistId).toBe("deduction-standard");
  });

  it("одному из детей исполнилось 18 — считается один, обычный вычет 63: экономия 8,19 в месяц", async () => {
    const { calculate, s } = setup([employment("employee"), children([18, 9])]);
    const result = await calculate(s, { kind: "children" });
    expect(result.children).toEqual({ count: 1, increased: false });
    expect(result.savingMonthly?.amount).toEqual(Money.of(819, "BYN"));
  });

  it("одинокий родитель с одним ребёнком — повышенный 120", async () => {
    const { calculate, s } = setup([
      employment("employee"),
      children([5]),
      familyStatus("singleParent"),
    ]);
    const result = await calculate(s, { kind: "children" });
    expect(result.deduction?.amount).toEqual(byn(120));
  });

  it("детей до 18 лет нет — вычет на детей не считается, причина названа", async () => {
    const { calculate, s } = setup([employment("employee"), children([19])]);
    const result = await calculate(s, { kind: "children" });
    expect(result).toMatchObject({ status: "not-applicable", reason: "no-children" });
    expect(result.savingYear).toBeNull();
  });
});

describe("TAX-07, пример 2 и TAX-04: жильё", () => {
  it("120 000 BYN при начисленной зарплате 2 500 — до 15 600,00 BYN и ровно 48 месяцев без «≈»", async () => {
    const { calculate, s } = setup([employment("employee")]);
    const result = await calculate(s, {
      kind: "housing",
      expenses: byn(120_000),
      income: { amount: byn(2500), basis: "gross" },
    });
    expect(result.savingTotal?.amount).toEqual(byn(15_600));
    expect(result.term).toMatchObject({ months: 48, approx: false });
    expect(result.savingMonthly?.amount).toEqual(byn(325));
    expect(result.flags).toEqual([]);
    expect(result.standard).toBeNull();
  });

  it("2 500 «на руки» — оценка начисленной 2 906,98, ≈ 41 месяц, пометки «оценка» и вопрос о зарплате", async () => {
    const { calculate, s } = setup([employment("employee")]);
    const result = await calculate(s, {
      kind: "housing",
      expenses: byn(120_000),
      income: { amount: byn(2500), basis: "net" },
    });
    expect(result.income?.amount).toEqual(Money.of(290_698, "BYN"));
    expect(result.term).toMatchObject({ months: 41, approx: true });
    expect(result.flags).toEqual(["income-estimated", "ask-gross"]);
  });

  it("«на руки» берётся из профиля, когда зарплата не названа: факт income.salary", async () => {
    const { calculate, s } = setup([employment("employee"), money("income.salary", 2500)]);
    const result = await calculate(s, { kind: "housing", expenses: byn(120_000) });
    expect(result.term).toMatchObject({ months: 41, approx: true });
  });

  it("взнос ФСЗН не подтверждён — оценки «на руки» нет, срока нет, ноль не подставляется; вопрос о зарплате", async () => {
    const { calculate, s } = setup([employment("employee")], ["fszn.employee-rate"]);
    const result = await calculate(s, {
      kind: "housing",
      expenses: byn(120_000),
      income: { amount: byn(2500), basis: "net" },
    });
    expect(result.income).toBeNull();
    expect(result.term).toBeNull();
    expect(result.termReason).toBe("no-income");
    expect(result.savingTotal?.amount).toEqual(byn(15_600));
    expect(result.flags).toEqual(["ask-gross"]);
  });

  it("стандартные вычеты применяются раньше имущественного: двое детей 240 в месяц удлиняют срок до ≈ 53 месяцев", async () => {
    const { calculate, s } = setup([employment("employee"), children([17, 9])]);
    const result = await calculate(s, {
      kind: "housing",
      expenses: byn(120_000),
      income: { amount: byn(2500), basis: "gross" },
    });
    expect(result.standard?.amount).toEqual(byn(240));
    expect(result.term).toMatchObject({ months: 53, approx: true });
  });

  it("зарплата ниже порога 1 308: к стандартным добавляется вычет 216 — база месяца 1 000 − 216", async () => {
    const { calculate, s } = setup([employment("employee")]);
    const result = await calculate(s, {
      kind: "housing",
      expenses: byn(10_000),
      income: { amount: byn(1000), basis: "gross" },
    });
    expect(result.standard?.amount).toEqual(byn(216));
    expect(result.term).toMatchObject({ months: 13, approx: true });
  });

  it("годовой доход выше 350 000 — предупреждение: ИМНС досчитает налог по итогам года (TAX-05)", async () => {
    const { calculate, s } = setup([employment("employee")]);
    const result = await calculate(s, {
      kind: "housing",
      expenses: byn(120_000),
      income: { amount: byn(30_000), basis: "gross" },
    });
    expect(result.flags).toContain("high-income");
  });
});

describe("TAX-02: тип занятости", () => {
  it("только НПД — вычет не считается и объясняется: чисел нет", async () => {
    const { calculate, s } = setup([employment("npd")]);
    const result = await calculate(s, { kind: "education", paid: byn(2000) });
    expect(result).toMatchObject({ status: "not-applicable", reason: "npd-only" });
    expect(result.savingTotal).toBeNull();
    expect(result.deduction).toBeNull();
  });

  it("НПД и зарплата — расчёт по зарплате, с пометкой", async () => {
    const { calculate, s } = setup([employment("npd"), money("income.gross", 2500)]);
    const result = await calculate(s, { kind: "education", paid: byn(2000) });
    expect(result.status).toBe("ok");
    expect(result.flags).toContain("npd-with-salary");
  });

  it("ИП — ставка ИП из таблицы (20 %), вычет только через декларацию ИМНС", async () => {
    const { calculate, s } = setup([employment("ip")]);
    const result = await calculate(s, { kind: "education", paid: byn(2000) });
    expect(result.ratePercent).toBe(20);
    expect(result.savingTotal?.amount).toEqual(byn(400));
    expect(result.ways).toEqual(["tax-office"]);
    expect(result.flags).toContain("ip-declaration");
  });
});

describe("TAX-03: только подтверждённые значения", () => {
  it("ставка подоходного налога ждёт подтверждения — «нет данных», называется параметр, ни одного числа", async () => {
    const { calculate, s } = setup([employment("employee")], ["ndfl.rate.base"]);
    const result = await calculate(s, { kind: "education", paid: byn(2000) });
    expect(result).toMatchObject({
      status: "no-data",
      reason: "rate-unconfirmed",
      missing: ["ndfl.rate.base"],
    });
    expect(result.savingTotal).toBeNull();
    expect(result.ratePercent).toBeNull();
  });

  it("не хватает суммы вычета на ребёнка — «нет данных» и для «Дети»", async () => {
    const { calculate, s } = setup(
      [employment("employee"), children([5])],
      ["ndfl.std-deduction.child"],
    );
    const result = await calculate(s, { kind: "children" });
    expect(result).toMatchObject({ status: "no-data", missing: ["ndfl.std-deduction.child"] });
  });
});
