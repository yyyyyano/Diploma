// TXN-02 на Postgres: страница + размер + total, устойчивая сортировка (день, время, id), поиск по тексту и названию
// категории, фильтры по периоду, счёту, категории, типу, сумме и источнику; чужие операции не видны.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { transactions } from "../infrastructure/db/schema.ts";
import {
  entry,
  newScope,
  transactionsWithJournal,
  WEB,
} from "../../../main/__fixtures__/transactions-with-journal.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

interface Seed {
  readonly occurredOn: string;
  readonly occurredTime?: string | null;
  readonly amountMinor?: number;
  readonly type?: string;
  readonly categoryCode?: string;
  readonly merchantName?: string;
  readonly description?: string;
  readonly source?: string;
  readonly accountId?: string;
}

/** Строки напрямую в таблицу (без остатков и истории): для проверки чтения нужны только сами операции. */
async function seed(s: ScopedDb, accountId: string, rows: readonly Seed[]) {
  await s.insert(transactions).values(
    rows.map((row) => {
      const type = row.type ?? "expense";
      return {
        accountId: row.accountId ?? accountId,
        type,
        direction: type === "expense" || type === "transfer" ? "out" : "in",
        occurredOn: row.occurredOn,
        occurredTime: row.occurredTime ?? null,
        amountMinor: row.amountMinor ?? 100,
        currency: "BYN",
        amountBynMinor: row.amountMinor ?? 100,
        description: row.description ?? "",
        merchantName: row.merchantName ?? null,
        categoryCode: type === "transfer" ? null : (row.categoryCode ?? "other"),
        categorySource: type === "transfer" ? null : "user",
        source: row.source ?? "manual",
      };
    }),
  );
}

async function setup() {
  const s = newScope(db);
  const t = transactionsWithJournal(db);
  const cash = await s.transaction((tx) => t.accounts.cash(tx));
  return { s, t, cash };
}

describe("TXN-02: страницы по 50", () => {
  it("120 операций: страницы 50 + 50 + 20, total 120, ни одной строки дважды, новые сверху", async () => {
    const { s, t, cash } = await setup();
    await seed(
      s,
      cash,
      Array.from({ length: 120 }, (_, i) => ({
        occurredOn: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`,
        amountMinor: 100 + i,
      })),
    );
    const pages = [
      await t.ops.list(s, { page: 1, pageSize: 50 }),
      await t.ops.list(s, { page: 2, pageSize: 50 }),
      await t.ops.list(s, { page: 3, pageSize: 50 }),
    ];
    expect(pages.map((p) => p.items.length)).toEqual([50, 50, 20]);
    expect(pages.map((p) => p.total)).toEqual([120, 120, 120]);
    const all = pages.flatMap((p) => p.items);
    expect(new Set(all.map((r) => r.id)).size).toBe(120);
    const days = all.map((r) => r.occurredOn);
    expect(days).toEqual([...days].sort().reverse());
  });

  it("размер страницы 100 отдаёт 100 строк; страница за пределами — пусто, но total прежний", async () => {
    const { s, t, cash } = await setup();
    await seed(
      s,
      cash,
      Array.from({ length: 120 }, () => ({ occurredOn: "2026-10-20" })),
    );
    expect((await t.ops.list(s, { page: 1, pageSize: 100 })).items).toHaveLength(100);
    const beyond = await t.ops.list(s, { page: 9, pageSize: 50 });
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(120);
  });

  it("одинаковые день и время — порядок по id (убывание): страницы не пересекаются при любом размере", async () => {
    const { s, t, cash } = await setup();
    await seed(
      s,
      cash,
      Array.from({ length: 7 }, () => ({ occurredOn: "2026-10-20", occurredTime: "10:00:00" })),
    );
    const small = [1, 2, 3, 4].flatMap((page) => [page]);
    const ids: string[] = [];
    for (const page of small) {
      ids.push(...(await t.ops.list(s, { page, pageSize: 2 })).items.map((r) => r.id));
    }
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it("в день: сначала позднее время, операции без времени (из выписки) — в конце дня", async () => {
    const { s, t, cash } = await setup();
    await seed(s, cash, [
      { occurredOn: "2026-10-20", occurredTime: null, merchantName: "без времени" },
      { occurredOn: "2026-10-20", occurredTime: "08:00:00", merchantName: "утро" },
      { occurredOn: "2026-10-20", occurredTime: "22:41:00", merchantName: "вечер" },
    ]);
    const { items } = await t.ops.list(s, { page: 1, pageSize: 50 });
    expect(items.map((r) => r.merchantName)).toEqual(["вечер", "утро", "без времени"]);
  });
});

describe("TXN-02: поиск и фильтры", () => {
  it("текст ищется в названии, описании из выписки и комментарии без учёта регистра; «%» — не подстановка", async () => {
    const { s, t, cash } = await setup();
    await seed(s, cash, [
      { occurredOn: "2026-10-20", merchantName: "Кофейня «Зерно»" },
      { occurredOn: "2026-10-19", description: "YANDEX.GO TAXI MINSK", merchantName: "Яндекс Go" },
      { occurredOn: "2026-10-18", merchantName: "Скидка 100%" },
    ]);
    const find = async (query: string) =>
      (await t.ops.list(s, { page: 1, pageSize: 50, query })).items.map((r) => r.merchantName);
    expect(await find("ЗЕРНО")).toEqual(["Кофейня «Зерно»"]);
    expect(await find("taxi minsk")).toEqual(["Яндекс Go"]);
    expect(await find("%")).toEqual(["Скидка 100%"]);
  });

  it("поиск по названию категории: «такси» находит категорию «Такси», а своя категория — по своему имени", async () => {
    const { s, t, cash } = await setup();
    const created = await db.owner.query<{ id: string }>(
      `insert into categories (household_id, user_id, name, kind, icon, color)
       values ($1, $2, 'Кружки малыша', 'expense', 'baby', 'kids') returning id`,
      [s.scope.householdId, s.scope.userId],
    );
    const customId = created.rows[0]?.id ?? "";
    await s.insert(transactions).values({
      accountId: cash,
      type: "expense",
      direction: "out",
      occurredOn: "2026-10-18",
      amountMinor: 100,
      currency: "BYN",
      amountBynMinor: 100,
      merchantName: "C",
      categoryId: customId,
      categorySource: "user",
      source: "manual",
    });
    await seed(s, cash, [
      { occurredOn: "2026-10-20", categoryCode: "taxi", merchantName: "A" },
      { occurredOn: "2026-10-19", categoryCode: "cafes", merchantName: "B" },
    ]);
    const find = async (query: string) =>
      (await t.ops.list(s, { page: 1, pageSize: 50, query })).items.map((r) => r.merchantName);
    expect(await find("такси")).toEqual(["A"]);
    expect(await find("кружки")).toEqual(["C"]);
  });

  it("период, тип, категория, источник и границы суммы в BYN складываются по «и»", async () => {
    const { s, t, cash } = await setup();
    await seed(s, cash, [
      { occurredOn: "2026-10-05", amountMinor: 500, categoryCode: "taxi", merchantName: "ранний" },
      { occurredOn: "2026-10-15", amountMinor: 1500, categoryCode: "taxi", merchantName: "нужный" },
      { occurredOn: "2026-10-15", amountMinor: 1500, categoryCode: "cafes", merchantName: "кафе" },
      {
        occurredOn: "2026-10-15",
        amountMinor: 1500,
        categoryCode: "taxi",
        source: "statement",
        merchantName: "выписка",
      },
      {
        occurredOn: "2026-10-25",
        amountMinor: 99_999,
        categoryCode: "taxi",
        merchantName: "дорогой",
      },
      { occurredOn: "2026-10-15", type: "income", categoryCode: "salary", merchantName: "доход" },
    ]);
    const list = async (extra: Record<string, unknown>) =>
      (await t.ops.list(s, { page: 1, pageSize: 50, ...extra } as never)).items
        .map((r) => r.merchantName ?? "")
        .sort((a, b) => a.localeCompare(b));
    expect(
      await list({
        from: "2026-10-10",
        to: "2026-10-20",
        type: "expense",
        categoryCode: "taxi",
        source: "manual",
        amountFrom: 1000,
        amountTo: 2000,
      }),
    ).toEqual(["нужный"]);
    expect(await list({ type: "income" })).toEqual(["доход"]);
    expect(await list({ source: "statement" })).toEqual(["выписка"]);
  });

  it("фильтр по счёту: только операции этого счёта", async () => {
    const { s, t, cash } = await setup();
    const card = await t.accounts.create(
      s,
      { kind: "card", name: "К", bank: null, mask: null, currency: "BYN", initialBalance: null },
      "web",
    );
    await seed(s, cash, [{ occurredOn: "2026-10-20", merchantName: "наличные" }]);
    await seed(s, card.account.id, [{ occurredOn: "2026-10-20", merchantName: "карта" }]);
    const byCard = await t.ops.list(s, { page: 1, pageSize: 50, accountId: card.account.id });
    expect(byCard.items.map((r) => r.merchantName)).toEqual(["карта"]);
    expect(byCard.total).toBe(1);
  });

  it("чужие операции не видны ни в списке, ни в total", async () => {
    const mine = await setup();
    const other = await setup();
    await seed(other.s, other.cash, [{ occurredOn: "2026-10-20", merchantName: "чужая" }]);
    await mine.t.ops.create(mine.s, entry(), WEB);
    const result = await mine.t.ops.list(mine.s, { page: 1, pageSize: 50 });
    expect(result.total).toBe(1);
    expect(result.items.map((r) => r.merchantName)).toEqual(["Кофейня «Зерно»"]);
  });
});
