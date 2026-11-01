// Ответы сервера для тестов экрана, карточки чата и сущности «сценарии покупки»: числа взяты из примера макета и SPEC
// (минимум −739,44, безопасный платёж 480 из дохода 3 200 и платежей 800). Тесты ничего не считают — проверяют показ.
import { AffordResult, SafeLoanResult } from "@kosht/contract";

export const TRACE = "0190f0a0-0000-7000-8000-0000000000a1";
const byn = (minor: number) => ({ minor, currency: "BYN" }) as const;
const amount = (minor: number) => ({ amount: byn(minor), traceId: TRACE });

const flat = (value: number, count = 91) => Array.from({ length: count }, () => value);

/** Покупка 3 000: «сейчас» и «после дохода» уходят в минус, «накопить» — 342,23 в месяц, 9 месяцев. */
export const RISKY = AffordResult.parse({
  today: "2026-10-21",
  price: byn(300_000),
  purchaseOn: "2026-10-21",
  horizon: { from: "2026-10-21", to: "2027-01-19" },
  estimate: true,
  needs: [],
  considered: {
    available: amount(283_964),
    dailySpend: amount(4539),
    monthlyIncome: amount(240_000),
    monthlyObligations: amount(67_777),
    unconverted: [],
  },
  unpriced: [{ type: "tax", rule: "property-tax", on: "2026-11-15" }],
  scenarios: [
    {
      kind: "now",
      status: "ok",
      reason: null,
      on: "2026-10-21",
      lowest: { amount: amount(-73_944), on: "2026-10-24" },
      risk: { firstOn: "2026-10-21", lowestOn: "2026-10-24", shortfall: amount(73_944) },
      goal: {
        id: "0190f0a0-0000-7000-8000-0000000000e1",
        name: "Отпуск",
        taken: byn(73_944),
        shiftMonths: { value: 7, traceId: TRACE },
      },
      goalUncovered: false,
      saving: null,
      recommended: false,
    },
    {
      kind: "after-income",
      status: "ok",
      reason: null,
      on: "2026-10-25",
      lowest: { amount: amount(-42_445), on: "2026-11-24" },
      risk: { firstOn: "2026-11-08", lowestOn: "2026-11-24", shortfall: amount(42_445) },
      goal: null,
      goalUncovered: true,
      saving: null,
      recommended: false,
    },
    {
      kind: "save",
      status: "ok",
      reason: null,
      on: null,
      lowest: null,
      risk: null,
      goal: null,
      goalUncovered: false,
      saving: {
        monthly: amount(34_223),
        months: { value: 9, traceId: TRACE },
        readyOn: "2027-07-21",
      },
      recommended: true,
    },
  ],
  chart: {
    from: "2026-10-21",
    baseline: flat(300_000),
    now: [...flat(-73_944, 30), ...flat(120_000, 61)],
    afterIncome: [...flat(283_964, 5), ...flat(-42_445, 86)],
    obligationsMonthly: byn(67_777),
  },
});

/** Покупка 1 500 без риска. */
export const SAFE = AffordResult.parse({
  ...RISKY,
  price: byn(150_000),
  unpriced: [],
  estimate: false,
  scenarios: [
    {
      ...RISKY.scenarios[0],
      lowest: { amount: amount(76_056), on: "2026-10-24" },
      risk: null,
      goal: null,
      recommended: true,
    },
    {
      ...RISKY.scenarios[1],
      lowest: { amount: amount(107_555), on: "2026-11-24" },
      risk: null,
      goalUncovered: false,
      recommended: false,
    },
    { ...RISKY.scenarios[2], recommended: false },
  ],
});

/** AFF-08: регулярного дохода нет — нужен ответ человека. */
export const NEEDS_INCOME = AffordResult.parse({
  ...RISKY,
  needs: ["income"],
  considered: { ...RISKY.considered, monthlyIncome: null, monthlyObligations: null },
  scenarios: [
    RISKY.scenarios[0],
    {
      ...RISKY.scenarios[1],
      status: "unavailable",
      reason: "no-income",
      on: null,
      lowest: null,
      risk: null,
      goalUncovered: false,
    },
    {
      ...RISKY.scenarios[2],
      status: "unavailable",
      reason: "no-income",
      saving: null,
      recommended: false,
    },
  ],
  chart: { ...RISKY.chart, afterIncome: null },
});

/** Пример AFF-05: доход 3 200, кредиты 800, предел 40 % → 1 280 → до 480; ставка 14 %, срок 60 мес. */
export const LOAN_OK = SafeLoanResult.parse({
  status: "ok",
  domesticGoods: false,
  limitPercent: 40,
  missing: [],
  income: amount(320_000),
  incomeSource: "history",
  currentPayments: amount(80_000),
  limitAmount: amount(128_000),
  safePayment: amount(48_000),
  exceeded: false,
  maxLoan: { amount: amount(2_062_896), rateBp: 1400, months: 60 },
});

export const LOAN_NO_LIMIT = SafeLoanResult.parse({
  ...LOAN_OK,
  status: "no-limit",
  limitPercent: null,
  missing: ["pdn.limit.default"],
  limitAmount: null,
  safePayment: null,
  maxLoan: null,
});
