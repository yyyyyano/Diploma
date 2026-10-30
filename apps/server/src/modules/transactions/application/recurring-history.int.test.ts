// REC-01 (источник для поиска регулярных): история операций пачкой — доходы и расходы с контрагентом и эквивалентом в BYN
// за период; без переводов, возвратов, операций без курса НБРБ, чужих и вне периода.
import { AccountId } from "@kosht/contract";
import { LocalDate, Money } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const day = (text: string) => LocalDate.parse(text);

describe("REC-01: recurringHistory", () => {
  it("расход и доход попадают с контрагентом, днём, суммой в BYN и категорией", async () => {
    const s = newScope(db);
    const t = transactionsWithJournal(db);
    await t.ops.create(
      s,
      entry({ occurredOn: day("2026-10-09"), amount: Money.of(6_000, "BYN") }),
      WEB,
    );
    await t.ops.create(
      s,
      entry({
        type: "income",
        occurredOn: day("2026-10-25"),
        amount: Money.of(144_000, "BYN"),
        merchant: "ООО «ТехноСофт»",
        category: { type: "system", code: "salary" as never },
      }),
      WEB,
    );
    const rows = await t.transactionsFacade.recurringHistory(s, {
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(rows).toMatchObject([
      {
        type: "expense",
        occurredOn: "2026-10-09",
        amountBynMinor: 6_000,
        categoryCode: "cafes",
        merchantName: "Кофейня «Зерно»",
      },
      { type: "income", occurredOn: "2026-10-25", amountBynMinor: 144_000, categoryCode: "salary" },
    ]);
    expect(rows[0]?.merchantKey).not.toBe("");
  });

  it("вне периода, без курса НБРБ и чужого домохозяйства — нет", async () => {
    const s = newScope(db);
    const t = transactionsWithJournal(db);
    await t.ops.create(s, entry({ occurredOn: day("2026-08-01") }), WEB);
    const usd = await t.accounts.create(
      s,
      { kind: "card", name: "USD", bank: null, mask: null, currency: "USD", initialBalance: null },
      "web",
    );
    t.setRatesUp(false);
    await t.ops.create(
      s,
      entry({ accountId: AccountId.parse(usd.account.id), amount: Money.of(1_000, "USD") }),
      WEB,
    );
    t.setRatesUp(true);
    const other = newScope(db);
    await t.ops.create(other, entry({ occurredOn: day("2026-10-10") }), WEB);
    expect(
      await t.transactionsFacade.recurringHistory(s, { from: "2026-10-01", to: "2026-10-31" }),
    ).toEqual([]);
  });

  it("перевод между счетами в историю не входит", async () => {
    const s = newScope(db);
    const t = transactionsWithJournal(db);
    await t.ops.create(
      s,
      entry({ type: "transfer", category: null, occurredOn: day("2026-10-10") }),
      WEB,
    );
    expect(
      await t.transactionsFacade.recurringHistory(s, { from: "2026-10-01", to: "2026-10-31" }),
    ).toEqual([]);
  });
});
