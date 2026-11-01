// Событие календаря для сайта и агента (CAL-01): строка таблицы или платёж `recurring` → запись контракта; суммы — листья `calc`
// с сохранённой трассой («Откуда эта цифра?»), итоги — суммы этих листьев по ключам calendar.* (P1, P2).
import { node, totalOf, type Calc } from "@kosht/calc";
import type { CalendarEntry, CalendarTotals } from "@kosht/contract";
import { LocalDate, Money, TraceId } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { RecurringEntry, UpcomingPayment } from "../../recurring/index.ts";
import type { EventRow } from "../infrastructure/db/calendar.repo.ts";
import type { Deps } from "./deps.ts";

const BYN = "BYN";

/** Запись без трассы суммы и сама сумма как расчёт: трассу присваивает `finalize` пачкой. */
export interface Item {
  readonly entry: Omit<CalendarEntry, "traceId">;
  readonly calc: Calc<Money> | null;
}

/** Хранимое событие → запись. Удалять можно только добавленное человеком (на сайте или через ассистента). */
export function storedItem(row: EventRow): Item {
  const calc =
    row.amountMinor === null ? null : node("calendar.eventAmount", Money.of(row.amountMinor, BYN));
  const own = row.origin === "user" || row.origin === "chat";
  return {
    entry: {
      id: row.id,
      type: row.type as CalendarEntry["type"],
      title: row.title,
      rule: row.rule,
      on: row.day === null ? null : LocalDate.parse(row.day),
      amount: calc?.value ?? null,
      approx: false,
      direction: calc === null ? null : "out",
      stored: true,
      remindDays: row.remindDays.filter((d): d is 0 | 1 | 7 | 30 => [0, 1, 7, 30].includes(d)),
      canDelete: own,
      origin: { kind: row.origin as CalendarEntry["origin"]["kind"], params: row.params },
      ref:
        row.refEntity === null || row.refId === null
          ? null
          : { entity: row.refEntity as "receipt" | "transaction", id: row.refId },
    },
    calc,
  };
}

/** Тип по платежу: поступление — доход, кредиты (категория «Кредиты») — кредит, прочее — регулярный платёж. */
function recurringType(flow: "income" | "expense", categoryCode: string | null) {
  if (flow === "income") return "income" as const;
  return categoryCode === "loans" ? ("credit" as const) : ("recurring" as const);
}

function recurringItem(input: {
  id: string;
  name: string;
  flow: "income" | "expense";
  categoryCode: string | null;
  on: LocalDate;
  amount: Calc<Money>;
  approx: boolean;
}): Item {
  const income = input.flow === "income";
  return {
    entry: {
      id: `recurring:${input.id}:${input.on}`,
      type: recurringType(input.flow, input.categoryCode),
      title: input.name,
      rule: null,
      on: input.on,
      amount: input.amount.value,
      approx: input.approx,
      direction: income ? "in" : "out",
      stored: false,
      remindDays: [],
      canDelete: false,
      origin: { kind: income ? "income" : "recurring", params: { name: input.name } },
      ref: { entity: "recurring", id: input.id },
    },
    calc: input.amount,
  };
}

/** Ожидаемый платёж или поступление по истории (REC-03): дата — прогноз, сумма — среднее. */
export function upcomingItem(payment: UpcomingPayment): Item {
  return recurringItem({
    id: payment.id,
    name: payment.name,
    flow: payment.flow,
    categoryCode: payment.categoryCode,
    on: payment.on,
    amount: payment.amount,
    approx: payment.approx,
  });
}

/** Прошедший платёж — операция-основание из истории регулярного платежа: сумма точная, трасса — лист «операция». */
export function pastItems(entry: RecurringEntry, from: LocalDate, to: LocalDate): Item[] {
  return entry.occurrences
    .filter((o) => o.on >= from && o.on <= to)
    .map((o) =>
      recurringItem({
        id: entry.id,
        name: entry.name,
        flow: entry.flow,
        categoryCode: entry.categoryCode,
        on: o.on,
        amount: node("recurring.occurrence", o.amount),
        approx: false,
      }),
    );
}

/** События по дню и id: недатированные (правила без даты) — в конец. */
export function sortItems(items: readonly Item[]): Item[] {
  return items.toSorted((a, b) => {
    const ad = a.entry.on ?? "9999-12-31";
    const bd = b.entry.on ?? "9999-12-31";
    return ad.localeCompare(bd) || a.entry.id.localeCompare(b.entry.id);
  });
}

/**
 * Трассы сумм событий и итоги: платежи и поступления по дням `totalsFrom…totalsTo` (включительно). Все расчёты сохраняются
 * одной пачкой (`explain.saveMany`, повтор — те же traceId); нет слагаемых — итога нет (`null`), а не ноль.
 */
export async function finalize(
  s: ScopedDb,
  explain: Deps["explain"],
  items: readonly Item[],
  totalsFrom: LocalDate,
  totalsTo: LocalDate,
): Promise<{ entries: CalendarEntry[]; totals: CalendarTotals }> {
  const inRange = (item: Item) =>
    item.entry.on !== null && item.entry.on >= totalsFrom && item.entry.on <= totalsTo;
  const parts = (direction: "out" | "in") =>
    items.flatMap((item) =>
      item.calc !== null && inRange(item) && item.entry.direction === direction ? [item.calc] : [],
    );
  const payments = parts("out");
  const income = parts("in");
  const paymentsTotal = payments.length === 0 ? null : totalOf("calendar.paymentsTotal", payments);
  const incomeTotal = income.length === 0 ? null : totalOf("calendar.incomeTotal", income);
  const calcs = [
    ...items.flatMap((item) => (item.calc === null ? [] : [item.calc])),
    ...(paymentsTotal === null ? [] : [paymentsTotal]),
    ...(incomeTotal === null ? [] : [incomeTotal]),
  ];
  const ids = calcs.length === 0 ? [] : await explain.saveMany(s, calcs);
  let at = 0;
  const entries = items.map((item): CalendarEntry => {
    const traceId = item.calc === null ? null : TraceId.parse(ids[at++]);
    return { ...item.entry, traceId };
  });
  const totalOfCalc = (calc: Calc<Money> | null) =>
    calc === null ? null : { amount: calc.value, traceId: TraceId.parse(ids[at++]) };
  const totals = { payments: totalOfCalc(paymentsTotal), income: totalOfCalc(incomeTotal) };
  return { entries, totals };
}
