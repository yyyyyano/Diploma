// FIN-20, FIN-21, FIN-22, PROF-03, EXPL-01, EXPL-02 на Postgres: свободный остаток по регулярным платежам, найденным в
// операциях (пример FIN-20 → 840 BYN), «по данным за N мес.», нет истории — null с причиной, трасса с операциями-основаниями
// и сохранённое объяснение, факт-предположение в профиле, прогноз по дням на настоящих остатках и ожидаемых платежах.
import { LocalDate } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clock, recurringWithJournal } from "../../../main/__fixtures__/recurring-with-journal.ts";
import { finTools } from "../agent/tools.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

type Series = {
  merchant: string;
  type: "income" | "expense";
  category: string;
  day: number;
  minor: number;
};

/** Пример FIN-20: доход 2 400, ЖКХ 180, связь 35, кредит 1 200, подписки 145 — каждый платёж раз в месяц. */
const EXAMPLE: readonly Series[] = [
  { merchant: "ТехноСофт", type: "income", category: "salary", day: 5, minor: 240_000 },
  { merchant: "ЕРИП ЖКУ", type: "expense", category: "utilities", day: 14, minor: 18_000 },
  { merchant: "Белтелеком", type: "expense", category: "telecom", day: 12, minor: 3_500 },
  { merchant: "Беларусбанк кредит", type: "expense", category: "loans", day: 23, minor: 120_000 },
  { merchant: "Яндекс Плюс", type: "expense", category: "subscriptions", day: 1, minor: 14_500 },
];

function months(series: readonly Series[], list: readonly string[]) {
  return series.flatMap((item) =>
    list.map((month) => ({
      date: `${month}-${String(item.day).padStart(2, "0")}`,
      merchant: item.merchant,
      type: item.type,
      amountMinor: item.minor,
      category: item.category,
    })),
  );
}

async function setup(history: readonly string[], today = "2026-10-28", series = EXAMPLE) {
  clock.set(`${today}T09:00:00Z`);
  const r = recurringWithJournal(db);
  const s = r.s();
  await r.seed(s, months(series, history));
  await r.recompute(s);
  return { r, s };
}

const JUL_OCT = ["2026-07", "2026-08", "2026-09", "2026-10"];

describe("FIN-20: свободный остаток", () => {
  it("пример: 2 400 − 180 − 35 − 1 200 − 145 = 840 BYN за июль–сентябрь, пять слагаемых по порядку", async () => {
    const { r, s } = await setup(JUL_OCT);
    const result = await r.fin.calculate(s);
    expect(result.months).toBe(3);
    expect(result.window).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(result.balance?.value).toEqual({ minor: 84_000, currency: "BYN" });
    expect(result.balance?.trace.inputs.map((input) => input.key)).toEqual([
      "fin.averageIncome",
      "fin.obligation.utilities",
      "fin.obligation.communication",
      "fin.obligation.loan",
      "fin.obligation.subscriptions",
    ]);
    expect(result.income?.value.minor).toBe(240_000);
  });

  it("в трассе — операции-основания: доход за июль–сентябрь это три операции", async () => {
    const { r, s } = await setup(JUL_OCT);
    const result = await r.fin.calculate(s);
    const refs: string[] = [];
    const walk = (node: { refs: readonly { id: string }[]; inputs: readonly never[] }) => {
      refs.push(...node.refs.map((ref) => ref.id));
      for (const child of node.inputs) walk(child);
    };
    walk(result.income?.trace as never);
    expect(refs).toHaveLength(3);
  });

  it("история с августа — «по данным за 2 мес.»: считается по августу и сентябрю", async () => {
    const { r, s } = await setup(["2026-08", "2026-09", "2026-10"]);
    const result = await r.fin.calculate(s);
    expect(result.months).toBe(2);
    expect(result.window).toEqual({ from: "2026-08-01", to: "2026-09-30" });
    expect(result.balance?.value.minor).toBe(84_000);
  });

  it("первая операция в этом месяце — полных месяцев нет: null и insufficient-history, а не 0", async () => {
    const { r, s } = await setup(["2026-10"]);
    const result = await r.fin.calculate(s);
    expect(result).toMatchObject({ months: 0, balance: null, reason: "insufficient-history" });
  });

  it("операций нет вовсе — то же: null и insufficient-history", async () => {
    clock.set("2026-10-28T09:00:00Z");
    const r = recurringWithJournal(db);
    expect(await r.fin.calculate(r.s())).toMatchObject({
      balance: null,
      reason: "insufficient-history",
    });
  });

  it("история есть, регулярного дохода нет — null и no-regular-income (платежи без дохода — не свободный остаток)", async () => {
    const { r, s } = await setup(
      JUL_OCT,
      "2026-10-28",
      EXAMPLE.filter((item) => item.type === "expense"),
    );
    const result = await r.fin.calculate(s);
    expect(result).toMatchObject({ balance: null, reason: "no-regular-income" });
    expect(result.obligations.length).toBeGreaterThan(0);
  });

  it("платежи больше дохода — отрицательный остаток как есть", async () => {
    const big = EXAMPLE.map((item) =>
      item.category === "loans" ? { ...item, minor: 300_000 } : item,
    );
    const { r, s } = await setup(JUL_OCT, "2026-10-28", big);
    expect((await r.fin.calculate(s)).balance?.value.minor).toBe(
      240_000 - 18_000 - 3_500 - 300_000 - 14_500,
    );
  });

  it("REC-04: исключённый платёж в остаток не входит — исключил кредит, остаток вырос", async () => {
    const { r, s } = await setup(JUL_OCT);
    const loan = (await r.read.list(s, { onDate: LocalDate.parse("2026-10-28") })).find(
      (e) => e.categoryCode === "loans",
    );
    await r.decisions.exclude(s, loan?.id ?? "", "web");
    expect((await r.fin.calculate(s)).balance?.value.minor).toBe(84_000 + 120_000);
  });
});

describe("EXPL-01, EXPL-02: показывается сохранённое", () => {
  it("view отдаёт traceId у остатка, дохода и каждой группы; повтор — те же id, строк не больше", async () => {
    const { r, s } = await setup(JUL_OCT);
    const first = await r.fin.view(s);
    const count = async () =>
      (
        await db.owner.query<{ n: number }>(
          "select count(*)::int as n from explanations where household_id = $1",
          [s.scope.householdId],
        )
      ).rows[0]?.n;
    const rows = await count();
    const again = await r.fin.view(s);
    expect(again).toEqual(first);
    expect(await count()).toBe(rows);
    expect(first.obligations.map((row) => row.group)).toEqual([
      "utilities",
      "communication",
      "loan",
      "subscriptions",
    ]);
    const saved = await r.t.explain.get(s, first.freeBalanceTraceId ?? "");
    expect(saved.trace.value).toEqual({ minor: 84_000, currency: "BYN" });
    expect(saved.period).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("нет числа — traceId остатка null, причина названа, доход 0", async () => {
    const { r, s } = await setup(["2026-10"]);
    expect(await r.fin.view(s)).toMatchObject({
      freeBalance: null,
      freeBalanceTraceId: null,
      reason: "insufficient-history",
      income: { minor: 0 },
      months: 0,
    });
  });
});

describe("PROF-03: факт «свободный остаток»", () => {
  const factOf = async (
    r: Awaited<ReturnType<typeof setup>>["r"],
    s: Awaited<ReturnType<typeof setup>>["s"],
  ) => (await r.facts.getFacts(s, ["finance.freeBalance"], LocalDate.parse("2026-10-28")))[0];

  it("предположение «по данным за 3 мес.» с суммой 840,00; повтор синхронизации ничего не пишет", async () => {
    const { r, s } = await setup(JUL_OCT);
    await r.fin.syncFact(s);
    const fact = await factOf(r, s);
    expect(fact).toMatchObject({
      status: "assumed",
      source: "system",
      value: { amount: { minor: 84_000 }, months: 3 },
    });
    const events = () => r.t.published.filter((e) => e.name === "profile.facts-changed").length;
    const before = events();
    await r.fin.syncFact(s);
    expect(events()).toBe(before);
  });

  it("человек удалил факт — синхронизация его не возвращает (PROF-05)", async () => {
    const { r, s } = await setup(JUL_OCT);
    await r.fin.syncFact(s);
    await r.facts.remove(s, (await factOf(r, s))?.id ?? "", "web");
    await r.fin.syncFact(s);
    expect(await factOf(r, s)).toBeUndefined();
  });

  it("нет числа (мало истории) — факта нет", async () => {
    const { r, s } = await setup(["2026-10"]);
    await r.fin.syncFact(s);
    expect(await factOf(r, s)).toBeUndefined();
  });
});

describe("FIN-22: прогноз остатка по дням до конца месяца", () => {
  it("20.10: платежи 22-го (связь) и 23-го (кредит) уменьшают остаток, пятое число — доход — уже прошло", async () => {
    const { r, s } = await setup(JUL_OCT.slice(0, 3), "2026-10-20");
    // 20.10 — ожидаются: связь 12.10 уже прошла, кредит 23.10; ЖКХ 14.10 прошла; доход 5.11 — за пределами.
    const forecast = await r.fin.forecast(s);
    expect(forecast.from).toBe("2026-10-20");
    expect(forecast.to).toBe("2026-10-31");
    expect(forecast.days).toHaveLength(12);
    const balances = forecast.days.map((day) => day.balance.value.minor);
    const start = balances[0] ?? 0;
    // С 23.10 вычитается кредит 1 200,00 — и больше ничего до конца месяца.
    expect(balances[2]).toBe(start);
    expect(balances[3]).toBe(start - 120_000);
    expect(balances.at(-1)).toBe(start - 120_000);
  });

  it("доход ожидается 25-го: остаток растёт в этот день; в трассе дня — ожидаемое поступление", async () => {
    const series = EXAMPLE.map((item) => (item.type === "income" ? { ...item, day: 25 } : item));
    const { r, s } = await setup(JUL_OCT.slice(0, 3), "2026-10-20", series);
    const forecast = await r.fin.forecast(s);
    const balances = forecast.days.map((day) => day.balance.value.minor);
    const start = balances[0] ?? 0;
    expect(balances[5] ?? 0).toBe(start - 120_000 + 240_000);
    expect(JSON.stringify(forecast.days[5]?.balance.trace)).toContain("fin.expectedIncome");
  });

  it("счёт без курса не считается нулём: он назван в unconverted, а в остаток не входит", async () => {
    const { r, s } = await setup(JUL_OCT.slice(0, 3), "2026-10-20");
    await r.t.accounts.create(
      s,
      {
        kind: "card",
        name: "USD",
        bank: null,
        mask: null,
        currency: "USD",
        initialBalance: { minor: 100_000, currency: "USD" } as never,
      },
      "web",
    );
    const forecast = await r.fin.forecast(s);
    expect(forecast.missingRates).toEqual(["USD"]);
    expect(forecast.unconverted).toHaveLength(1);
  });
});

describe("AGT-03: get_free_balance", () => {
  it("инструмент отдаёт те же числа по схеме контракта; во входе нет владельца", async () => {
    const { r, s } = await setup(JUL_OCT);
    const { freeBalance } = finTools(r.fin);
    const output = freeBalance.output.parse(
      await freeBalance.execute(
        { s, requestId: "tool-test", channel: "web" },
        freeBalance.input.parse({}),
      ),
    );
    expect(output).toMatchObject({ months: 3, freeBalance: { minor: 84_000, currency: "BYN" } });
    expect(freeBalance.input.parse({ householdId: "чужое" })).toEqual({});
  });

  it("чужое домохозяйство ничего не видит: 0 месяцев и null", async () => {
    const { r } = await setup(JUL_OCT);
    expect(await r.fin.view(r.s())).toMatchObject({ months: 0, freeBalance: null });
  });
});
