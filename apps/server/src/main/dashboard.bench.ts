// Бюджет «главная (дашборд) ≤ 300 мс p95 на сервере» (CONSTRAINTS.md, DASH-01…04) — `make bench`. Синтетический набор:
// 12 месяцев, 1 200 операций на 5 счетах (часть — с разбивкой чека по категориям), 12 регулярных платежей, 3 лимита, 2 цели и
// чужие домохозяйства (для настоящих индексов). Замеряется сценарий `overview` целиком — настоящие соседи (transactions,
// accounts, fin, budgets, recurring), аудит SQL, сборка ответа и `explain.saveMany`; прогрев отдельно, в замер идут второй и
// последующие вызовы (повторный замер на демо-данных — T-054). p95 — из этого прогона, число печатается.
import { LocalDate } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedDb } from "../platform/db/scoped-db.ts";
import { recurringItems } from "../modules/recurring/infrastructure/db/schema.ts";
import {
  transactions,
  transactionSplits,
} from "../modules/transactions/infrastructure/db/schema.ts";
import { budgetsWithJournal, clock, newScope } from "./__fixtures__/budgets-with-journal.ts";

const BUDGET_MS = 300;
const TODAY = "2026-10-28";
const OPERATIONS = 1_200;

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

/** Детерминированный ГПСЧ (mulberry32): набор одинаков от прогона к прогону. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const CATEGORIES = [
  "groceries",
  "cafes",
  "taxi",
  "transport",
  "utilities",
  "health",
  "leisure",
  "other",
  "clothes",
  "education",
];

function day(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

async function seedOperations(
  s: ScopedDb,
  accountIds: readonly string[],
  count: number,
  seed: number,
) {
  const next = random(seed);
  const start = Date.UTC(2025, 10, 1);
  const rows = Array.from({ length: count }, (_, index) => {
    const income = index % 40 === 0;
    const minor = income
      ? 100_000 + Math.floor(next() * 100_000)
      : 100 + Math.floor(next() * 20_000);
    return {
      accountId: accountIds[Math.floor(next() * accountIds.length)] ?? "",
      type: income ? "income" : "expense",
      direction: income ? "in" : "out",
      occurredOn: day(start + Math.floor(next() * 365) * 86_400_000),
      occurredTime: null,
      amountMinor: minor,
      currency: "BYN",
      amountBynMinor: minor,
      description: `POS ${String(index)}`,
      merchantName: "Магазин",
      categoryCode: income
        ? "salary"
        : (CATEGORIES[Math.floor(next() * CATEGORIES.length)] ?? "other"),
      categorySource: "keyword",
      source: "statement",
    };
  });
  const ids: { id: string; amount: number }[] = [];
  for (let from = 0; from < rows.length; from += 500) {
    const inserted = await s
      .insert(transactions)
      .values(rows.slice(from, from + 500))
      .returning({ id: transactions.id, amount: transactions.amountMinor });
    ids.push(...inserted.map((row) => ({ id: row.id, amount: row.amount })));
  }
  return ids;
}

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

describe("DASH-01: главная на 12 месяцах и 1 200 операциях", () => {
  it(`overview целиком (с saveMany) — p95 не больше ${String(BUDGET_MS)} мс`, async () => {
    clock.set(`${TODAY}T09:00:00Z`);
    const b = budgetsWithJournal(db);
    const s = newScope(db);
    const other = newScope(db);
    const cash = await s.transaction((tx) => b.r.t.accounts.cash(tx));
    const accountIds = [cash];
    for (const name of ["Карта А", "Карта Б", "Вклад", "Накопительный"]) {
      const kind = name === "Вклад" ? "deposit" : name === "Накопительный" ? "savings" : "card";
      const created = await b.r.t.accounts.create(
        s,
        { kind, name, bank: null, mask: null, currency: "BYN", initialBalance: null },
        "web",
      );
      accountIds.push(created.account.id);
    }
    const ids = await seedOperations(s, accountIds, OPERATIONS, 1);
    // Разбивка чека: каждая двадцатая операция идёт по двум категориям.
    const splitRows = ids
      .filter((_, index) => index % 20 === 1)
      .flatMap((row) => [
        { transactionId: row.id, position: 0, categoryCode: "groceries", amountMinor: 1 },
        {
          transactionId: row.id,
          position: 1,
          categoryCode: "health",
          amountMinor: Math.max(1, row.amount - 1),
        },
      ]);
    await s.insert(transactionSplits).values(splitRows.filter((row) => row.amountMinor > 0));
    // 12 регулярных платежей: найденные и названные человеком — как после поиска по истории.
    const regulars = Array.from({ length: 12 }, (_, index) => ({
      seriesKey: `manual|bench-${String(index)}`,
      name: `Платёж ${String(index)}`,
      flow: index === 0 ? "income" : "expense",
      section: index === 0 ? "income" : index < 6 ? "mandatory" : "subscriptions",
      period: "month",
      state: "active",
      source: "manual",
      anchorDay: 1 + index * 2,
      manualAmountMinor: 5_000 + index * 1_000,
      nextExpectedOn: `2026-11-${String(1 + index * 2).padStart(2, "0")}`,
      userFixed: ["amount"],
    }));
    await s.insert(recurringItems).values(regulars);
    // Лимиты и цели: три лимита, копилка и цель по накопительному счёту.
    for (const code of ["cafes", "taxi", "groceries"]) {
      await b.limits.set(
        s,
        { categoryKey: `system:${code}` as never, limit: { minor: 30_000, currency: "BYN" } },
        "web",
      );
    }
    await b.goals.create(
      s,
      {
        name: "Отпуск",
        kind: "piggy",
        target: { minor: 300_000, currency: "BYN" },
        deadline: "2027-06-01",
      } as never,
      "web",
    );
    await b.goals.create(
      s,
      {
        name: "Резерв",
        kind: "account",
        target: { minor: 500_000, currency: "BYN" },
        deadline: "2027-09-01",
        accountId: accountIds[4],
      } as never,
      "web",
    );
    const foreignCash = await other.transaction((tx) => b.r.t.accounts.cash(tx));
    await seedOperations(other, [foreignCash], 1_000, 2);
    await db.owner.query("analyze transactions");

    const input = { from: LocalDate.parse("2026-10-01"), to: LocalDate.parse("2026-10-31") };
    // Первый вызов пишет трассы (INSERT), прогрев планов и соединений; в замер — следующие.
    for (let i = 0; i < 10; i += 1) await b.dashboard.view(s, input);
    const samples: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const started = performance.now();
      await b.dashboard.view(
        s,
        i % 5 === 4
          ? { from: LocalDate.parse("2026-09-01"), to: LocalDate.parse("2026-09-30") }
          : input,
      );
      samples.push(performance.now() - started);
    }
    const value = p95(samples);
    console.log(
      `bench dashboard.overview · 12 мес., ${String(OPERATIONS)} операций, 5 счетов: p95 = ${value.toFixed(1)} мс`,
    );
    const view = await b.dashboard.view(s, input);
    expect(view.hasData).toBe(true);
    expect(view.limits).toHaveLength(3);
    expect(view.goals).toHaveLength(2);
    expect(value).toBeLessThanOrEqual(BUDGET_MS);
  });
});
