// TAX-01…07: калькулятор налоговых вычетов (подоходный налог, ст. 209–211 НК) — чистые функции с трассой. Ставки и суммы
// вычетов приходят узлами (`Calc<number>` в базисных пунктах, `Calc<Money>`) из таблицы ставок со ссылкой на норму: в коде
// их нет (P1). Правила TAX-05: вычет уменьшает облагаемый доход, поэтому вернуть можно не больше налога с этого дохода;
// неиспользованный остаток социального и имущественного вычета переносится; стандартные вычеты применяются раньше
// имущественного. Округление — явное, с правилом в трассе.
import { Money } from "@kosht/kernel";
import { node, trace, type Calc } from "../calc.ts";
import { mul, mulRate, sub } from "../money-ops.ts";
import { divideRounded, roundingNote } from "../rounding.ts";

const ROUNDING = { rounding: "half-up-kopeck" } as const;
const BASIS_POINTS = 10_000;
const MONTHS_IN_YEAR = 12;

/** Меньшее из двух сумм; обе — в трассе (`op: "value"` — значение выбрано, а не посчитано действием). */
function minMoney(key: string, a: Calc<Money>, b: Calc<Money>): Calc<Money> {
  Money.sameCurrency([a.value, b.value]);
  const value = a.value.minor <= b.value.minor ? a.value : b.value;
  return { value, trace: trace(key, "value", value, [a.trace, b.trace], [], "наименьшее из двух") };
}

/** Ставки не меньше нуля и вместе меньше 100 %: иначе «на руки» не превратить в начисленное. */
function netShare(income: Calc<number>, fszn: Calc<number>): number {
  const share = BASIS_POINTS - income.value - fszn.value;
  if (income.value < 0 || fszn.value < 0 || share <= 0) {
    throw new RangeError(
      `tax.grossEstimate: ставки ${String(income.value)} и ${String(fszn.value)} (сотые доли процента) оставляют на руки ${String(share)} из ${String(BASIS_POINTS)}.`,
    );
  }
  return share;
}

/**
 * TAX-04: начисленный доход оценивается как «на руки» ÷ (100 % − подоходный налог − взнос ФСЗН): 2 500,00 ÷ 0,86 ≈ 2 906,98.
 * Ставки — узлы из таблицы ставок; результат — оценка, сервер помечает его так и задаёт вопрос о зарплате в расчётном листке.
 */
export function grossFromNet(
  net: Calc<Money>,
  incomeRateBp: Calc<number>,
  fsznRateBp: Calc<number>,
): Calc<Money> {
  const share = netShare(incomeRateBp, fsznRateBp);
  const minor = divideRounded(
    BigInt(net.value.minor) * BigInt(BASIS_POINTS),
    BigInt(share),
    ROUNDING.rounding,
  );
  const value = Money.of(Number(minor), net.value.currency);
  return {
    value,
    trace: trace(
      "tax.grossEstimate",
      "mul",
      value,
      [net.trace, incomeRateBp.trace, fsznRateBp.trace],
      [],
      `× 100 % ÷ (100 % − ставки); ${roundingNote(ROUNDING.rounding)}`,
    ),
  };
}

export interface EducationDeduction {
  /** Вычет: сумма, уплаченная за обучение (ст. 210 НК), без верхнего предела. */
  readonly deduction: Calc<Money>;
  /** Экономия: налог, который не придётся заплатить, — с той части вычета, что покрыта доходом. */
  readonly saving: Calc<Money>;
  /** Остаток вычета, который переносится на следующие годы; `null` — доход за год не указан, остаток неизвестен. */
  readonly carryOver: Calc<Money> | null;
  /** Доход за год не указан: сумма — «до» (верхняя граница). */
  readonly upperBound: boolean;
}

/**
 * TAX-07, пример 1; TAX-05: обучение 2 000 BYN → вычет 2 000, экономия 260 BYN при ставке 13 %; если облагаемого дохода за год
 * меньше оплаты, вычет используется на сумму дохода, остаток переносится.
 */
export function educationDeduction(input: {
  readonly paid: Money;
  readonly rateBp: Calc<number>;
  /** Облагаемый доход за год после стандартных вычетов; `null` — не известен. */
  readonly annualTaxable: Calc<Money> | null;
}): EducationDeduction {
  if (input.paid.minor <= 0) {
    throw new RangeError("tax.education.deduction: сумма оплаты обучения должна быть больше нуля.");
  }
  const deduction = node("tax.education.deduction", input.paid);
  if (input.annualTaxable === null) {
    return {
      deduction,
      saving: mulRate("tax.saving.education", deduction, input.rateBp, ROUNDING),
      carryOver: null,
      upperBound: true,
    };
  }
  const available =
    input.annualTaxable.value.minor < 0
      ? node("tax.education.annualTaxable", Money.of(0, input.paid.currency))
      : input.annualTaxable;
  const used = minMoney("tax.education.used", deduction, available);
  return {
    deduction,
    saving: mulRate("tax.saving.education", used, input.rateBp, ROUNDING),
    carryOver: sub("tax.education.carryOver", deduction, [used]),
    upperBound: false,
  };
}

export interface ChildrenDeduction {
  /** Вычет в месяц: сумма на ребёнка × число детей. */
  readonly deductionMonthly: Calc<Money>;
  readonly savingMonthly: Calc<Money>;
  readonly savingYearly: Calc<Money>;
  /** Доход в месяц не указан: сумма — «до». */
  readonly upperBound: boolean;
}

/**
 * TAX-07, пример 3: двое детей → 120 × 2 = 240 BYN вычета в месяц, экономия 31,20 BYN в месяц и 374,40 BYN в год (суммы 2026 года);
 * TAX-05: вычет не больше дохода месяца — вернуть можно не больше налога, который уплачен.
 */
export function childrenDeduction(input: {
  readonly children: number;
  /** Сумма на ребёнка в месяц: обычная или повышенная — выбирает вызывающий по правилам ст. 209. */
  readonly perChild: Calc<Money>;
  readonly rateBp: Calc<number>;
  readonly monthlyIncome: Calc<Money> | null;
}): ChildrenDeduction {
  if (!Number.isSafeInteger(input.children) || input.children < 1) {
    throw new RangeError(
      `tax.children.deductionMonthly: детей не меньше одного, получено ${String(input.children)}.`,
    );
  }
  const deductionMonthly = mul(
    "tax.children.deductionMonthly",
    input.perChild,
    node("tax.children.count", input.children),
  );
  const base =
    input.monthlyIncome === null
      ? deductionMonthly
      : minMoney(
          "tax.children.base",
          deductionMonthly,
          input.monthlyIncome.value.minor < 0
            ? node("tax.grossIncome", Money.of(0, input.perChild.value.currency))
            : input.monthlyIncome,
        );
  const savingMonthly = mulRate("tax.saving.childrenMonthly", base, input.rateBp, ROUNDING);
  return {
    deductionMonthly,
    savingMonthly,
    savingYearly: mul(
      "tax.saving.childrenYearly",
      savingMonthly,
      node("tax.monthsInYear", MONTHS_IN_YEAR),
    ),
    upperBound: input.monthlyIncome === null,
  };
}

/**
 * TAX-05: облагаемая база месяца для имущественного вычета = доход − стандартные вычеты (они применяются раньше), не меньше нуля.
 */
export function monthlyBase(gross: Calc<Money>, standard: Calc<Money>): Calc<Money> {
  if (gross.value.minor < standard.value.minor) {
    return node("tax.housing.monthlyBase", Money.of(0, gross.value.currency), {
      note: "доход не больше стандартных вычетов",
    });
  }
  return sub("tax.housing.monthlyBase", gross, [standard]);
}

export interface HousingTerm {
  /** Облагаемая база месяца, из которой вычитается имущественный вычет. */
  readonly monthlyBase: Calc<Money>;
  readonly monthlySaving: Calc<Money>;
  /** Срок в месяцах: целое — как есть, дробное — округлено до ближайшего (в трассе — помесячный план). */
  readonly months: Calc<number>;
  /** Срок округлён: показывается «≈ N мес.». */
  readonly approx: boolean;
  /** План: полных месяцев по всей базе и вычет последнего неполного месяца. */
  readonly fullMonths: Calc<number>;
  readonly lastMonth: Calc<Money>;
}

export interface HousingDeduction {
  /** Экономия за весь вычет: расходы × ставка — «до», пока вычет не использован целиком. */
  readonly totalSaving: Calc<Money>;
  readonly term: HousingTerm | null;
  /** Почему срока нет: доход не известен или целиком уходит на стандартные вычеты. */
  readonly termReason: "no-income" | "no-taxable" | null;
}

/**
 * TAX-07, пример 2: квартира 120 000 BYN → экономия до 15 600 BYN; при начисленной зарплате 2 500 без других вычетов — 48 месяцев,
 * при 2 906,98 (2 500 «на руки») — ≈ 41. Срок = расходы ÷ база месяца; TAX-05: стандартные вычеты вычитаются из базы раньше.
 */
export function housingDeduction(input: {
  readonly expenses: Money;
  readonly rateBp: Calc<number>;
  readonly monthlyGross: Calc<Money> | null;
  /** Стандартные вычеты в месяц (ст. 209), применяемые раньше имущественного; ноль — их нет. */
  readonly standardMonthly: Calc<Money>;
}): HousingDeduction {
  if (input.expenses.minor <= 0) {
    throw new RangeError("tax.housing.expenses: расходы на жильё должны быть больше нуля.");
  }
  const expenses = node("tax.housing.expenses", input.expenses);
  const totalSaving = mulRate("tax.saving.housingTotal", expenses, input.rateBp, ROUNDING);
  if (input.monthlyGross === null) return { totalSaving, term: null, termReason: "no-income" };

  const base = monthlyBase(input.monthlyGross, input.standardMonthly);
  if (base.value.minor <= 0) return { totalSaving, term: null, termReason: "no-taxable" };

  const total = BigInt(expenses.value.minor);
  const step = BigInt(base.value.minor);
  const full = total / step;
  const fullMonths = node("tax.housing.fullMonths", Number(full));
  const lastMonth = node(
    "tax.housing.lastMonth",
    Money.of(Number(total - full * step), expenses.value.currency),
    { note: "вычет последнего неполного месяца; ноль — срок целый" },
  );
  const monthsValue = Number(divideRounded(total, step, ROUNDING.rounding));
  const months: Calc<number> = {
    value: monthsValue,
    trace: trace(
      "tax.housing.months",
      "mul",
      monthsValue,
      [expenses.trace, base.trace, fullMonths.trace, lastMonth.trace],
      [],
      `расходы ÷ база месяца; ${roundingNote(ROUNDING.rounding)}`,
    ),
  };
  return {
    totalSaving,
    term: {
      monthlyBase: base,
      monthlySaving: mulRate("tax.housing.monthlySaving", base, input.rateBp, ROUNDING),
      months,
      approx: lastMonth.value.minor !== 0,
      fullMonths,
      lastMonth,
    },
    termReason: null,
  };
}
