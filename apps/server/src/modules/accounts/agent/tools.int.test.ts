// AGT-03, ROLE-01: инструмент list_accounts без модели — только счета домохозяйства scope запуска.
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../platform/db/scoped-db.ts";
import { listAccountsTool } from "./tools.ts";

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
    "insert into accounts (household_id, user_id, kind) values ($1, $2, 'cash') returning id",
    [scope.householdId, scope.userId],
  );
  return rows[0]?.id ?? "";
}

describe("AGT-03: list_accounts", () => {
  it("возвращает «Наличные» домохозяйства запуска и не видит чужих; выход — по схеме инструмента", async () => {
    const own = await cash(1);
    await cash(2);
    const s = createScopedDb(db.pool, testScope({ user: 1, household: 1 }));
    const output = await listAccountsTool.execute(
      { s, requestId: "tool-test", channel: "web" },
      listAccountsTool.input.parse({}),
    );
    expect(listAccountsTool.output.parse(output)).toEqual({
      items: [{ id: own, kind: "cash", name: null, balance: { minor: 0, currency: "BYN" } }],
    });
  });

  it("во входе нет владельца: лишнее поле householdId схема отбрасывает", () => {
    expect(listAccountsTool.input.parse({ householdId: "чужое" })).toEqual({});
  });
});
