// Синтетическая история операций на 6 месяцев (T-030, REC-01, QA-01): детерминированная — одно зерно, один результат.
// Вымышленные получатели; регулярные платежи известны заранее (`expected`), поиск их не угадывает, а сверяется с ними.
// Среди регулярных — аванс и зарплата одного нанимателя, ЖКХ с разной суммой, подписки, платёж, который перестал
// приходить, и «шум»: ежедневный кофе, разовые покупки в магазине.
import { rng } from "../statements/ledger.ts";

export type Period = "week" | "month" | "quarter" | "year";

export interface HistoryOperation {
  /** ISO-дата «2026-09-15». */
  readonly date: string;
  /** Название контрагента как в выписке. */
  readonly merchant: string;
  readonly type: "income" | "expense";
  readonly amountMinor: number;
  /** Встроенная категория (SYSTEM_CATEGORIES). */
  readonly category: string;
}

export interface ExpectedRegular {
  readonly merchant: string;
  readonly type: "income" | "expense";
  readonly period: Period;
  /** День месяца серии. */
  readonly day: number;
  readonly section: "income" | "mandatory" | "subscriptions" | "other";
  readonly state: "active" | "suggested";
  /** Последний платёж серии: у прекратившихся он раньше конца истории. */
  readonly lastDate: string;
  /** Сколько повторов в истории. */
  readonly repeats: number;
}

export interface History {
  readonly operations: readonly HistoryOperation[];
  readonly expected: readonly ExpectedRegular[];
}

interface Series {
  readonly merchant: string;
  readonly type: "income" | "expense";
  readonly day: number;
  /** Сумма месяца i (0 — самый ранний): копейки. */
  readonly amount: (month: number, random: () => number) => number;
  readonly category: string;
  readonly section: ExpectedRegular["section"];
  /** Сколько последних месяцев платежа нет (прекратился). */
  readonly stoppedFor?: number;
  readonly dayJitter?: number;
}

const fixed = (minor: number) => () => minor;

const SERIES: readonly Series[] = [
  {
    merchant: "ООО «ТехноСофт»",
    type: "income",
    day: 25,
    amount: fixed(144_000),
    category: "salary",
    section: "income",
  },
  {
    merchant: "ООО «ТехноСофт»",
    type: "income",
    day: 10,
    amount: fixed(96_000),
    category: "salary",
    section: "income",
  },
  {
    merchant: "Беларусбанк кредит",
    type: "expense",
    day: 23,
    amount: fixed(41_000),
    category: "loans",
    section: "mandatory",
  },
  {
    merchant: "ЕРИП Расчёт ЖКУ",
    type: "expense",
    day: 14,
    amount: (month, random) => 17_000 + Math.round(random() * 3_000) + month * 100,
    category: "utilities",
    section: "mandatory",
  },
  {
    merchant: "Белтелеком интернет",
    type: "expense",
    day: 22,
    amount: fixed(3_290),
    category: "telecom",
    section: "mandatory",
    dayJitter: 1,
  },
  {
    merchant: "А1 мобильная связь",
    type: "expense",
    day: 2,
    amount: fixed(1_000),
    category: "telecom",
    section: "mandatory",
  },
  {
    merchant: "Яндекс Плюс",
    type: "expense",
    day: 1,
    amount: fixed(1_599),
    category: "subscriptions",
    section: "subscriptions",
  },
  {
    merchant: "VK Музыка",
    type: "expense",
    day: 5,
    amount: fixed(1_299),
    category: "subscriptions",
    section: "subscriptions",
  },
  {
    merchant: "Центр РобоКлуб кружок",
    type: "expense",
    day: 9,
    amount: fixed(6_000),
    category: "kids",
    section: "other",
  },
  {
    merchant: "Клуб Атлетик абонемент",
    type: "expense",
    day: 12,
    amount: fixed(5_500),
    category: "leisure",
    section: "other",
    stoppedFor: 1,
  },
];

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthOf(today: string, back: number): { year: number; month: number } {
  const [y = 0, m = 1] = today.split("-").map(Number);
  const index = y * 12 + (m - 1) - back;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function dayIn(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** История за `months` полных месяцев до месяца `today` и его начало до `today` включительно. */
export function generateHistory(options: {
  seed: number;
  today: string;
  months?: number;
}): History {
  const random = rng(options.seed);
  const months = options.months ?? 6;
  const operations: HistoryOperation[] = [];
  const expected: ExpectedRegular[] = [];
  for (const series of SERIES) {
    let repeats = 0;
    let last = "";
    for (let back = months; back >= 0; back -= 1) {
      if (series.stoppedFor !== undefined && back < series.stoppedFor) continue;
      const { year, month } = monthOf(options.today, back);
      const planned = dayIn(year, month, series.day);
      const date =
        series.dayJitter === undefined
          ? planned
          : addDays(planned, Math.round((random() - 0.5) * 2 * series.dayJitter));
      if (date > options.today) continue;
      operations.push({
        date,
        merchant: series.merchant,
        type: series.type,
        amountMinor: series.amount(months - back, random),
        category: series.category,
      });
      repeats += 1;
      last = date;
    }
    expected.push({
      merchant: series.merchant,
      type: series.type,
      period: "month",
      day: series.day,
      section: series.section,
      state: series.section === "other" ? "suggested" : "active",
      lastDate: last,
      repeats,
    });
  }
  // Шум: кофе в «Зерне» почти каждый день, продукты в разные дни и суммы — это не регулярные платежи.
  for (let offset = 0; offset < months * 30; offset += 1) {
    const date = addDays(options.today, -offset);
    if (random() < 0.7) {
      operations.push({
        date,
        merchant: "Кофейня «Зерно»",
        type: "expense",
        amountMinor: 600 + Math.round(random() * 100),
        category: "cafes",
      });
    }
    if (random() < 0.25) {
      operations.push({
        date,
        merchant: "Евроопт",
        type: "expense",
        amountMinor: 1_500 + Math.round(random() * 9_000),
        category: "groceries",
      });
    }
  }
  return {
    operations: operations.toSorted(
      (a, b) => a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant),
    ),
    expected,
  };
}
