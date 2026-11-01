import { Money } from "@kosht/kernel";
import { describe, expect, it } from "vitest";
import type { ExportInput, ExportRow } from "./model.ts";
import { monthsBetween, summarize } from "./summary.ts";

const byn = (minor: number) => Money.of(minor, "BYN");

function row(patch: Partial<ExportRow> & Pick<ExportRow, "date" | "type">): ExportRow {
  return {
    account: "Карта",
    counterparty: "Евроопт",
    category: "Продукты",
    amount: byn(1000),
    amountByn: byn(1000),
    ...patch,
  };
}

const input = (rows: ExportRow[], extra: Partial<ExportInput> = {}): ExportInput => ({
  from: "2026-09-01",
  to: "2026-10-31",
  rows,
  limitMonth: "2026-10",
  limits: [],
  ...extra,
});

describe("monthsBetween", () => {
  it("перечисляет месяцы от начала до конца периода, переходя через год", () => {
    expect(monthsBetween("2026-11-15", "2027-01-02")).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("XLS-02: числа сводки", () => {
  it("расходы категории по месяцам — покупки минус возвраты, переводы не входят", () => {
    const summary = summarize(
      input([
        row({ date: "2026-09-03", type: "expense", amountByn: byn(1000) }),
        row({ date: "2026-09-10", type: "expense", amountByn: byn(550) }),
        row({ date: "2026-09-12", type: "refund", amountByn: byn(200) }),
        row({ date: "2026-10-02", type: "expense", amountByn: byn(700) }),
        row({ date: "2026-10-05", type: "transfer", category: "", amountByn: byn(99999) }),
      ]),
    );
    expect(summary.months).toEqual(["2026-09", "2026-10"]);
    expect(summary.categories).toHaveLength(1);
    expect(summary.categories[0]?.byMonth.map((m) => m.minor)).toEqual([1350, 700]);
    expect(summary.categories[0]?.total.minor).toBe(2050);
    expect(summary.expenses.total.minor).toBe(2050);
  });

  it("доходы и разница по месяцам", () => {
    const summary = summarize(
      input([
        row({ date: "2026-09-01", type: "income", category: "Зарплата", amountByn: byn(300000) }),
        row({ date: "2026-09-02", type: "expense", amountByn: byn(12000) }),
        row({ date: "2026-10-02", type: "expense", amountByn: byn(5000) }),
      ]),
    );
    expect(summary.income.byMonth.map((m) => m.minor)).toEqual([300000, 0]);
    expect(summary.difference.byMonth.map((m) => m.minor)).toEqual([288000, -5000]);
    expect(summary.difference.total.minor).toBe(283000);
  });

  it("операция без курса в суммы не входит", () => {
    const summary = summarize(
      input([
        row({ date: "2026-09-03", type: "expense", amountByn: byn(1000) }),
        row({
          date: "2026-09-04",
          type: "expense",
          amount: Money.of(500, "USD"),
          amountByn: null,
        }),
      ]),
    );
    expect(summary.expenses.total.minor).toBe(1000);
  });

  it("крупные категории — выше", () => {
    const summary = summarize(
      input([
        row({ date: "2026-09-03", type: "expense", category: "Кафе", amountByn: byn(300) }),
        row({ date: "2026-09-03", type: "expense", category: "Продукты", amountByn: byn(900) }),
      ]),
    );
    expect(summary.categories.map((c) => c.name)).toEqual(["Продукты", "Кафе"]);
  });

  it("лимиты: факт месяца и процент вниз до целого", () => {
    const summary = summarize(
      input(
        [
          row({ date: "2026-09-03", type: "expense", amountByn: byn(99900) }),
          row({ date: "2026-10-03", type: "expense", amountByn: byn(15999) }),
        ],
        { limits: [{ category: "Продукты", limit: byn(20000) }] },
      ),
    );
    expect(summary.limits).toEqual([
      { category: "Продукты", limit: byn(20000), fact: byn(15999), percent: 79 },
    ]);
  });

  it("лимит без трат — факт ноль и процент ноль", () => {
    const summary = summarize(input([], { limits: [{ category: "Кафе", limit: byn(5000) }] }));
    expect(summary.limits[0]).toMatchObject({ fact: byn(0), percent: 0 });
  });
});
