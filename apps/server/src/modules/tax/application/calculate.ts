// Расчёт вычета «Обучение / Жильё / Дети» (TAX-01…07, PROF-06): собирает вход из профиля и таблицы ставок, считает `@kosht/calc`,
// сохраняет каждое показываемое число для «Откуда эта цифра?» (`explain.saveMany`) и отдаёт результат сайту и агенту. Правила:
// только подтверждённые значения таблицы — нет значения, ответ «нет данных», а не ноль; только НПД — вычет не считается и
// объясняется; «на руки» без начисленной — оценка с пометкой и вопросом (TAX-04); ИП — через декларацию (TAX-02).
import {
  childrenDeduction,
  educationDeduction,
  grossFromNet,
  housingDeduction,
  monthlyBase,
  mul,
  node,
  sum,
  type Calc,
} from "@kosht/calc";
import type {
  CalculateDeductionInput,
  DeductionAmount,
  DeductionFlag,
  DeductionKind,
  DeductionResult,
  EmploymentType,
  FamilyStatus,
  ProfileFact,
} from "@kosht/contract";
import { Money, TraceId, type Clock, type TraceValue } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { ExplainFacade } from "../../explain/index.ts";
import type { NormTablesFacade } from "../../norm-tables/index.ts";
import type { ProfileFacade } from "../../profile/index.ts";
import { standardChildren } from "../domain/children.ts";
import { classifyEmployment } from "../domain/employment.ts";
import { makeNormCitations, type CitationDeps } from "./citations.ts";
import { loadRates, moneyNode, percentNode, type FoundRate } from "./rates.ts";

const BYN = "BYN";
const MONTHS_IN_YEAR = 12;

const CHECKLISTS = {
  education: "deduction-education",
  housing: "deduction-housing",
  children: "deduction-standard",
} as const satisfies Record<DeductionKind, DeductionResult["checklistId"]>;

const FACT_KEYS = [
  "employment",
  "children",
  "familyStatus",
  "income.gross",
  "income.salary",
  "income.regular",
] as const;

export interface CalculateDeps extends CitationDeps {
  readonly clock: Clock;
  readonly profile: Pick<ProfileFacade, "getFacts">;
  readonly normTables: Pick<NormTablesFacade, "rate">;
  readonly explain: Pick<ExplainFacade, "saveMany">;
}

const zero = (): Money => Money.of(0, BYN);

/** Факт нужного ключа: значение с проверкой вида (тип сужается по `key`). */
function factOf<K extends string>(
  facts: readonly ProfileFact[],
  key: K,
): (ProfileFact & { value: { key: K } }) | undefined {
  return facts.find((fact): fact is ProfileFact & { value: { key: K } } => fact.value.key === key);
}

export function makeCalculate(d: CalculateDeps) {
  const citations = makeNormCitations(d);

  /** Результат без чисел: вычет не считается (только НПД, нет детей) или нет подтверждённых значений. */
  function empty(
    kind: DeductionKind,
    year: number,
    employment: readonly EmploymentType[] | null,
    status: DeductionResult["status"],
    reason: DeductionResult["reason"],
    missing: readonly string[],
  ): DeductionResult {
    return {
      kind,
      status,
      reason,
      missing: [...missing],
      year,
      employment: employment === null ? null : [...employment],
      ratePercent: null,
      deduction: null,
      savingMonthly: null,
      savingYear: null,
      savingTotal: null,
      carryOver: null,
      term: null,
      termReason: null,
      income: null,
      standard: null,
      children: null,
      ways: [],
      flags: [],
      checklistId: CHECKLISTS[kind],
      citations: [],
    };
  }

  return async function calculate(
    s: ScopedDb,
    input: CalculateDeductionInput,
  ): Promise<DeductionResult> {
    const today = d.clock.today();
    const year = Number(today.slice(0, 4));
    const facts = await d.profile.getFacts(s, FACT_KEYS, today);
    const employmentFact = factOf(facts, "employment");
    const types = employmentFact?.value.types ?? null;
    const grossFact = factOf(facts, "income.gross");
    const netFact = factOf(facts, "income.salary") ?? factOf(facts, "income.regular");
    const income = "income" in input ? input.income : undefined;
    const hasSalary = income !== undefined || grossFact !== undefined || netFact !== undefined;

    const rule = classifyEmployment(types, hasSalary);
    if (rule.mode === "npd-only") {
      return empty(input.kind, year, types, "not-applicable", "npd-only", []);
    }

    // TAX-03: только подтверждённые значения; хоть одного нет — «нет данных».
    const rateParam = rule.mode === "ip" ? "ip.rate.base" : "ndfl.rate.base";
    const rates = await loadRates(
      d.normTables.rate,
      [
        rateParam,
        "ndfl.std-deduction.base",
        "ndfl.std-deduction.base-income-limit",
        "ndfl.std-deduction.child",
        "ndfl.std-deduction.child-increased",
      ],
      today,
    );
    if (rates.missing.length > 0) {
      return empty(input.kind, year, types, "no-data", "rate-unconfirmed", rates.missing);
    }
    const need = (param: string): FoundRate => {
      const rate = rates.found.get(param);
      if (rate === undefined) throw new Error(`tax.rates: нет значения ${param} после проверки`);
      return rate;
    };
    const incomeRate = percentNode("tax.incomeRate", need(rateParam));

    // Начисленный доход в месяц: названный, из профиля или оценка «на руки» ÷ 0,86 (TAX-04) — оценка только по подтверждённым ставкам.
    const estimate = async (net: Money): Promise<Calc<Money> | null> => {
      const [fszn, ndfl] = await Promise.all([
        d.normTables.rate("fszn.employee-rate", today),
        d.normTables.rate("ndfl.rate.base", today),
      ]);
      if (!fszn.found || !ndfl.found) return null;
      return grossFromNet(
        node("tax.netIncome", net),
        percentNode("tax.incomeRate", ndfl),
        percentNode("tax.fsznRate", fszn),
      );
    };
    let monthlyGross: Calc<Money> | null = null;
    let estimated = false;
    if (income?.basis === "gross") {
      monthlyGross = node("tax.grossIncome", income.amount);
    } else if (income?.basis === "net") {
      monthlyGross = await estimate(income.amount);
      estimated = monthlyGross !== null;
    } else if (grossFact !== undefined) {
      monthlyGross = node("tax.grossIncome", grossFact.value.amount, { note: "из профиля" });
    } else if (netFact !== undefined) {
      monthlyGross = await estimate(netFact.value.amount);
      estimated = monthlyGross !== null;
    }

    // Стандартные вычеты ст. 209 применяются раньше имущественного (TAX-05); у ИП — только за месяцы без основного места работы.
    const kids = standardChildren(
      factOf(facts, "children")?.value.children,
      factOf(facts, "children")?.evaluation,
      factOf(facts, "familyStatus")?.value.statuses ?? ([] as FamilyStatus[]),
    );
    const perChild = moneyNode(
      "tax.children.perChild",
      need(kids.increased ? "ndfl.std-deduction.child-increased" : "ndfl.std-deduction.child"),
    );
    const standardParts: Calc<Money>[] = [];
    if (rule.mode === "employee") {
      const limit = need("ndfl.std-deduction.base-income-limit").value;
      if (monthlyGross !== null && monthlyGross.value.minor <= limit) {
        standardParts.push(moneyNode("tax.standard.base", need("ndfl.std-deduction.base")));
      }
      if (kids.count > 0) {
        standardParts.push(
          mul("tax.standard.children", perChild, node("tax.children.count", kids.count)),
        );
      }
    }
    const [firstPart, ...otherParts] = standardParts;
    const standard =
      firstPart === undefined
        ? node("tax.standardMonthly", zero())
        : sum("tax.standardMonthly", [firstPart, ...otherParts]);

    const flags = new Set<DeductionFlag>(rule.flags);
    if (estimated) flags.add("income-estimated");

    // Числа результата — в порядке показа; `traceIds` получают те, что не `null`.
    const shown: {
      deduction: Calc<Money> | null;
      savingMonthly: Calc<Money> | null;
      savingYear: Calc<Money> | null;
      savingTotal: Calc<Money> | null;
      carryOver: Calc<Money> | null;
      months: Calc<number> | null;
    } = {
      deduction: null,
      savingMonthly: null,
      savingYear: null,
      savingTotal: null,
      carryOver: null,
      months: null,
    };
    let approx = false;
    let termReason: DeductionResult["termReason"] = null;
    let usedIncome = false;

    if (input.kind === "education") {
      const annualTaxable: Calc<Money> | null =
        input.annualTaxable !== undefined
          ? node("tax.education.annualTaxable", input.annualTaxable, { note: "указано вами" })
          : monthlyGross !== null && rule.mode === "employee"
            ? mul(
                "tax.education.annualTaxable",
                monthlyBase(monthlyGross, standard),
                node("tax.monthsInYear", MONTHS_IN_YEAR),
              )
            : null;
      const result = educationDeduction({
        paid: input.paid,
        rateBp: incomeRate,
        annualTaxable,
      });
      shown.deduction = result.deduction;
      shown.savingYear = result.saving;
      shown.savingTotal = result.saving;
      shown.carryOver =
        result.carryOver !== null && result.carryOver.value.minor > 0 ? result.carryOver : null;
      if (result.upperBound) flags.add("upper-bound");
      usedIncome = input.annualTaxable === undefined;
    } else if (input.kind === "housing") {
      const result = housingDeduction({
        expenses: input.expenses,
        rateBp: incomeRate,
        monthlyGross,
        standardMonthly: standard,
      });
      shown.deduction = node("tax.housing.expenses", input.expenses);
      shown.savingTotal = result.totalSaving;
      if (result.term !== null) {
        shown.savingMonthly = result.term.monthlySaving;
        shown.savingYear = result.term.yearlySaving;
        shown.months = result.term.months;
        approx = result.term.approx;
      }
      termReason = result.termReason;
      usedIncome = true;
    } else {
      if (kids.count === 0) {
        return empty("children", year, types, "not-applicable", "no-children", []);
      }
      const result = childrenDeduction({
        children: kids.count,
        perChild,
        rateBp: incomeRate,
        monthlyIncome: monthlyGross,
      });
      shown.deduction = result.deductionMonthly;
      shown.savingMonthly = result.savingMonthly;
      shown.savingYear = result.savingYearly;
      if (result.upperBound) flags.add("upper-bound");
      usedIncome = true;
    }

    // TAX-04: зарплата до вычета налогов нужна, когда её нет или она оценена по «на руки».
    if (usedIncome && (monthlyGross === null || estimated)) flags.add("ask-gross");

    // TAX-05: годовой доход выше порога повышенной ставки — ИМНС досчитает налог по итогам года.
    if (monthlyGross !== null) {
      const threshold = await d.normTables.rate(
        rule.mode === "ip" ? "ip.rate.high-from" : "ndfl.rate.high-from",
        today,
      );
      if (threshold.found && monthlyGross.value.minor * MONTHS_IN_YEAR > threshold.value) {
        flags.add("high-income");
      }
    }

    // Каждое показываемое число — в «Откуда эта цифра?» одной пачкой.
    const calcs: Calc<TraceValue>[] = [];
    const slot = (calc: Calc<TraceValue> | null): number =>
      calc === null ? -1 : calcs.push(calc) - 1;
    const slots = {
      deduction: slot(shown.deduction),
      savingMonthly: slot(shown.savingMonthly),
      savingYear: slot(shown.savingYear),
      savingTotal: slot(shown.savingTotal),
      carryOver: slot(shown.carryOver),
      months: slot(shown.months),
      income: slot(usedIncome ? monthlyGross : null),
      standard: slot(usedIncome && standardParts.length > 0 ? standard : null),
    };
    const ids = await d.explain.saveMany(s, calcs);
    const idAt = (index: number): TraceId => {
      const id = ids[index];
      if (id === undefined) throw new Error("tax.explain: нет traceId для числа результата");
      return TraceId.parse(id);
    };
    const money = (calc: Calc<Money> | null, index: number): DeductionAmount | null =>
      calc === null ? null : { amount: calc.value, traceId: idAt(index) };

    const ways: DeductionResult["ways"] =
      rule.mode === "ip"
        ? ["tax-office"]
        : input.kind === "children"
          ? ["employer"]
          : ["employer", "tax-office"];

    return {
      kind: input.kind,
      status: "ok",
      reason: null,
      missing: [],
      year,
      employment: types === null ? null : [...types],
      ratePercent: incomeRate.value % 100 === 0 ? incomeRate.value / 100 : null,
      deduction: money(shown.deduction, slots.deduction),
      savingMonthly: money(shown.savingMonthly, slots.savingMonthly),
      savingYear: money(shown.savingYear, slots.savingYear),
      savingTotal: money(shown.savingTotal, slots.savingTotal),
      carryOver: money(shown.carryOver, slots.carryOver),
      term:
        shown.months === null
          ? null
          : { months: shown.months.value, approx, traceId: idAt(slots.months) },
      termReason,
      income: money(usedIncome ? monthlyGross : null, slots.income),
      standard: money(usedIncome && standardParts.length > 0 ? standard : null, slots.standard),
      children: input.kind === "children" ? { count: kids.count, increased: kids.increased } : null,
      ways,
      flags: [...flags],
      checklistId: CHECKLISTS[input.kind],
      citations: await citations(input.kind),
    };
  };
}

export type Calculate = ReturnType<typeof makeCalculate>;
