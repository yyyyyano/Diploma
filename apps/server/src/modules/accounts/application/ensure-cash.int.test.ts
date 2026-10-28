// STMT-01: «Наличные» у каждого пользователя — на настоящем Postgres: идемпотентно при повторной и параллельной
// доставке события, сигнал «счета изменились» — только когда счёт создан, список — своего домохозяйства.
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb, type ScopedDb } from "../../../platform/db/scoped-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { Realtime } from "../../../platform/realtime/realtime.ts";
import { listAccounts } from "../infrastructure/db/accounts.repo.ts";
import { makeEnsureCash } from "./ensure-cash.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

function ensureCashWithSignals() {
  const signals: { household: string; entity: string; ids: readonly string[] }[] = [];
  const realtime: Realtime = {
    changed: async (s: ScopedDb, signal) => {
      signals.push({ household: s.scope.householdId, entity: signal.entity, ids: signal.ids });
    },
    progress: async () => {},
  };
  return {
    ensureCash: makeEnsureCash({
      realtime,
      log: memoryLogger().log,
      clock: new FakeClock("2026-10-28T09:00:00Z"),
    }),
    signals,
  };
}

describe("STMT-01: «Наличные» с самого начала", () => {
  it("первая доставка создаёт «Наличные · 0,00 BYN» и шлёт сигнал account; повтор — ничего", async () => {
    const s = createScopedDb(db.pool, testScope({ user: 1, household: 1 }));
    const { ensureCash, signals } = ensureCashWithSignals();
    await ensureCash(s);
    await ensureCash(s);
    const items = await listAccounts(s);
    expect(items).toEqual([
      {
        id: expect.any(String),
        kind: "cash",
        name: null,
        bank: null,
        mask: null,
        currency: "BYN",
        initialBalanceMinor: 0,
        balanceMinor: 0,
        balanceOn: "2026-10-28",
        balanceSource: "manual",
      },
    ]);
    expect(signals).toEqual([
      { household: s.scope.householdId, entity: "account", ids: [items[0]?.id] },
    ]);
  });

  it("параллельная двойная доставка — один счёт", async () => {
    const s = createScopedDb(db.pool, testScope({ user: 2, household: 2 }));
    const { ensureCash } = ensureCashWithSignals();
    await Promise.all([ensureCash(s), ensureCash(s), ensureCash(s)]);
    expect(await listAccounts(s)).toHaveLength(1);
  });

  it("список — только своего домохозяйства", async () => {
    const a = createScopedDb(db.pool, testScope({ user: 3, household: 3 }));
    const b = createScopedDb(db.pool, testScope({ user: 4, household: 4 }));
    const { ensureCash } = ensureCashWithSignals();
    await ensureCash(a);
    await ensureCash(b);
    const [own] = await listAccounts(a);
    const [foreign] = await listAccounts(b);
    expect(own?.id).not.toBe(foreign?.id);
    expect((await listAccounts(a)).map((item) => item.id)).toEqual([own?.id]);
  });
});
