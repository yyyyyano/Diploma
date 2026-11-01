// Числа листов «Сводка» и «Лимиты» (XLS-02): считает `@kosht/calc`, а книга кладёт их как кэш-результат формул (P1, ADR-0012):
// программа открывается без пересчёта — просмотрщики без движка формул показывают те же числа, что и Excel после пересчёта.
// Правила те же, что у сайта (FIN-01): переводы в итоги не входят, возврат уменьшает расходы своей категории, операция без курса
// не входит в суммы.
import { categoryTotal, limitPercent, node, sub, totalOf, type Calc } from "@kosht/calc";
import { Money } from "@kosht/kernel";
import type { ExportInput, ExportRow } from "./model.ts";

const BYN = "BYN";

export interface SummaryLine {
  readonly name: string;
  readonly byMonth: readonly Money[];
  readonly total: Money;
}

export interface LimitLine {
  readonly category: string;
  readonly limit: Money;
  readonly fact: Money;
  /** Процент лимита вниз до целого (BUD-02); лимит не больше нуля — `null`. */
  readonly percent: number | null;
}

export interface Summary {
  /** Месяцы выгрузки «ГГГГ-ММ» по порядку: от месяца начала до месяца конца периода. */
  readonly months: readonly string[];
  /** Расходы по категориям (покупки минус возвраты): крупные категории — выше. */
  readonly categories: readonly SummaryLine[];
  readonly expenses: SummaryLine;
  readonly income: SummaryLine;
  readonly difference: SummaryLine;
  readonly limits: readonly LimitLine[];
}

/** Месяцы «ГГГГ-ММ» от месяца `from` до месяца `to` включительно. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    if (key > last) return months;
    months.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

const zero = (key: string): Calc<Money> => node(key, Money.of(0, BYN));

/** Строки, чья сумма идёт в итоги: есть эквивалент в BYN. */
const counted = (rows: readonly ExportRow[]) => rows.filter((row) => row.amountByn !== null);

const leaves = (key: string, rows: readonly ExportRow[]): Calc<Money>[] =>
  counted(rows).map((row) => node(key, row.amountByn ?? Money.of(0, BYN)));

/** Расходы набора строк: покупки минус возвраты. */
function expenseOf(rows: readonly ExportRow[]): Calc<Money> {
  const purchases = totalOf(
    "transactions.expense",
    leaves(
      "transactions.expense",
      rows.filter((row) => row.type === "expense"),
    ),
  );
  const refunds = leaves(
    "transactions.refund",
    rows.filter((row) => row.type === "refund"),
  );
  return categoryTotal(
    purchases,
    refunds.length === 0 ? undefined : totalOf("transactions.refund", refunds),
  );
}

function incomeOf(rows: readonly ExportRow[]): Calc<Money> {
  return totalOf(
    "transactions.income",
    leaves(
      "transactions.income",
      rows.filter((row) => row.type === "income"),
    ),
  );
}

const monthOf = (row: ExportRow): string => row.date.slice(0, 7);

function line(name: string, cells: readonly Calc<Money>[]): SummaryLine {
  return {
    name,
    byMonth: cells.map((cell) => cell.value),
    total: totalOf("transactions.categoryTotal", cells).value,
  };
}

export function summarize(input: ExportInput): Summary {
  const months = monthsBetween(input.from, input.to);
  const inMonth = (rows: readonly ExportRow[], month: string) =>
    rows.filter((row) => monthOf(row) === month);

  const spending = input.rows.filter((row) => row.type === "expense" || row.type === "refund");
  const names = [...new Set(spending.map((row) => row.category))];
  const categories = names
    .map((name) => {
      const own = spending.filter((row) => row.category === name);
      return line(
        name,
        months.map((month) => expenseOf(inMonth(own, month))),
      );
    })
    .toSorted((a, b) => b.total.minor - a.total.minor || a.name.localeCompare(b.name, "ru"));

  const expenseCells = months.map((month) => expenseOf(inMonth(spending, month)));
  const incomeCells = months.map((month) => incomeOf(inMonth(input.rows, month)));
  const differenceCells = months.map((_, index) =>
    sub("transactions.balanceDelta", incomeCells[index] ?? zero("transactions.income"), [
      expenseCells[index] ?? zero("transactions.expense"),
    ]),
  );

  const monthRows = inMonth(spending, input.limitMonth);
  const limits = input.limits.map((entry): LimitLine => {
    const fact = expenseOf(monthRows.filter((row) => row.category === entry.category));
    return {
      category: entry.category,
      limit: entry.limit,
      fact: fact.value,
      percent: entry.limit.minor > 0 ? limitPercent(fact, entry.limit).value : null,
    };
  });

  return {
    months,
    categories,
    expenses: line("expenses", expenseCells),
    income: line("income", incomeCells),
    difference: {
      name: "difference",
      byMonth: differenceCells.map((cell) => cell.value),
      total: sub("transactions.balanceDelta", totalOf("transactions.income", incomeCells), [
        totalOf("transactions.expense", expenseCells),
      ]).value,
    },
    limits,
  };
}
