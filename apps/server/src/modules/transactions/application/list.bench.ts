// Бюджет «список операций (страница 50 строк) ≤ 150 мс p95 на сервере» (CONSTRAINTS.md, TXN-02) — `make bench`.
// Синтетический набор: 10 000 операций одного домохозяйства за два года на пяти счетах (плюс чужие — для
// настоящих индексов), 30 % без времени. Замеряется сценарий `list` целиком (настоящий Postgres, ScopedDb с аудитом SQL,
// сборка ответа): страницы по 50 строк по всей глубине, затем те же страницы под фильтрами и поиском. p95 — из этого
// прогона, число печатается.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { transactions } from "../infrastructure/db/schema.ts";
import { newScope, transactionsWithJournal } from "./__fixtures__/transactions-with-journal.ts";

const BUDGET_MS = 150;
const ROWS = 10_000;

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

/** Детерминированный ГПСЧ (mulberry32): набор и порядок запросов одинаковы от прогона к прогону. */
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
];
const MERCHANTS = [
  "Евроопт",
  "Кофейня «Зерно»",
  "Яндекс Go",
  "А1",
  "Белнефтехим АЗС",
  "Аптека №15",
];

async function seedRows(s: ScopedDb, accountIds: readonly string[], count: number, seed: number) {
  const next = random(seed);
  const rows = Array.from({ length: count }, () => {
    const day = new Date(Date.UTC(2025, 0, 1) + Math.floor(next() * 730) * 86_400_000);
    const withTime = next() > 0.3;
    const minor = 100 + Math.floor(next() * 50_000);
    return {
      accountId: accountIds[Math.floor(next() * accountIds.length)] ?? "",
      type: "expense",
      direction: "out",
      occurredOn: day.toISOString().slice(0, 10),
      occurredTime: withTime ? `${String(Math.floor(next() * 24)).padStart(2, "0")}:00:00` : null,
      amountMinor: minor,
      currency: "BYN",
      amountBynMinor: minor,
      description: `POS ${String(Math.floor(next() * 1e6))}`,
      merchantName: MERCHANTS[Math.floor(next() * MERCHANTS.length)] ?? null,
      categoryCode: CATEGORIES[Math.floor(next() * CATEGORIES.length)] ?? "other",
      categorySource: "keyword",
      source: "statement",
    };
  });
  for (let start = 0; start < rows.length; start += 1000) {
    await s.insert(transactions).values(rows.slice(start, start + 1000));
  }
}

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

async function measure(runs: number, call: (i: number) => Promise<unknown>): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    await call(i);
    samples.push(performance.now() - started);
  }
  return samples;
}

describe("TXN-02: список операций на 10 000 строк", () => {
  it(`страница 50 строк — p95 не больше ${String(BUDGET_MS)} мс, и под фильтрами тоже`, async () => {
    const s = newScope(db);
    const other = newScope(db);
    const t = transactionsWithJournal(db);
    const cash = await s.transaction((tx) => t.accounts.cash(tx));
    const cards = [];
    for (const name of ["А", "Б", "В", "Г"]) {
      const card = await t.accounts.create(
        s,
        { kind: "card", name, bank: null, mask: null, currency: "BYN", initialBalance: null },
        "web",
      );
      cards.push(card.account.id);
    }
    const accountIds = [cash, ...cards];
    await seedRows(s, accountIds, ROWS, 1);
    const foreignCash = await other.transaction((tx) => t.accounts.cash(tx));
    await seedRows(other, [foreignCash], 3000, 2);
    await db.owner.query("analyze transactions");

    // Прогрев: планы, кэш аудитора SQL и соединения пула.
    await measure(20, (i) => t.ops.list(s, { page: 1 + i, pageSize: 50 }));

    const pages = await measure(300, (i) =>
      t.ops.list(s, { page: 1 + ((i * 7) % 200), pageSize: 50 }),
    );
    const first = await measure(100, () => t.ops.list(s, { page: 1, pageSize: 50 }));
    const filters = [
      { categoryCode: "taxi" as const },
      { from: "2025-06-01", to: "2025-06-30" },
      { accountId: cards[0] },
      { type: "expense" as const, amountFrom: 10_000, amountTo: 30_000 },
      { query: "зерно" },
      { query: "такси" },
    ];
    const filtered = await measure(300, (i) =>
      t.ops.list(s, { page: 1, pageSize: 50, ...filters[i % filters.length] } as never),
    );

    const report = {
      "страницы по всей глубине": p95(pages),
      "первая страница": p95(first),
      "под фильтрами и поиском": p95(filtered),
    };
    for (const [name, value] of Object.entries(report)) {
      console.log(`bench transactions.list · ${name}: p95 = ${value.toFixed(1)} мс`);
    }
    expect(await t.ops.list(s, { page: 1, pageSize: 50 })).toMatchObject({ total: ROWS });
    for (const value of Object.values(report)) expect(value).toBeLessThanOrEqual(BUDGET_MS);
  });
});
