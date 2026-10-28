// AGT-03 «счета», AGT-05, AGT-07, ROLE-01: инструменты счетов без модели — список своего домохозяйства с итогами,
// создать и переименовать — сразу с undoToken, удалить — только ожидающее решение (счёт на месте до «Да»).
import { AccountId } from "@kosht/contract";
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../platform/db/scoped-db.ts";
import { accountsWithJournal } from "../application/__fixtures__/accounts-with-journal.ts";
import { accountsTools } from "./tools.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

async function cash(user: number): Promise<string> {
  const scope = testScope({ user, household: user });
  const { rows } = await db.owner.query<{ id: string }>(
    "insert into accounts (household_id, user_id, kind, balance_on) values ($1, $2, 'cash', '2026-10-28') returning id",
    [scope.householdId, scope.userId],
  );
  return rows[0]?.id ?? "";
}

describe("AGT-03: инструменты счетов", () => {
  it("list_accounts — «Наличные» домохозяйства запуска, чужих не видно; выход — по схеме инструмента", async () => {
    const own = await cash(1);
    await cash(2);
    const s = createScopedDb(db.pool, testScope({ user: 1, household: 1 }));
    const { list } = accountsTools(accountsWithJournal().accounts);
    const output = await list.execute(
      { s, requestId: "tool-test", channel: "web" },
      list.input.parse({}),
    );
    expect(list.output.parse(output)).toMatchObject({
      items: [{ id: own, kind: "cash", name: null, balance: { minor: 0, currency: "BYN" } }],
      totals: { total: { minor: 0, currency: "BYN" }, missingRates: [] },
    });
  });

  it("во входе нет владельца: лишнее поле householdId схема отбрасывает", () => {
    const { list } = accountsTools(accountsWithJournal().accounts);
    expect(list.input.parse({ householdId: "чужое" })).toEqual({});
  });

  it("create_account и rename_account — сразу с undoToken; delete_account — решение, счёт на месте", async () => {
    const s = createScopedDb(db.pool, testScope({ user: 3, household: 3 }));
    const fixture = accountsWithJournal();
    const { create, rename, remove } = accountsTools(fixture.accounts);
    const ctx = { s, requestId: "tool-test", channel: "telegram" as const };
    const created = await create.execute(
      ctx,
      create.input.parse({ account: { kind: "deposit", name: "Вклад", currency: "BYN" } }),
    );
    expect(created).toMatchObject({
      account: { kind: "deposit", name: "Вклад" },
      undoToken: expect.any(String),
    });
    const renamed = await rename.execute(ctx, {
      id: AccountId.parse(created.account.id),
      name: "Вклад на год",
    });
    expect(renamed.account.name).toBe("Вклад на год");
    const draft = await remove.propose(ctx, { id: AccountId.parse(created.account.id) });
    expect(draft).toEqual({
      action: "accounts.delete",
      payload: { decisionId: expect.any(String) },
    });
    expect((await fixture.accounts.list(s)).items).toHaveLength(1);
  });
});
