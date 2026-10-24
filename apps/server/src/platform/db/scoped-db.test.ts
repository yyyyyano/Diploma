// ScopedDb, SystemDb и crossTenant без базы: вместо pg — клиент-счётчик, который записывает, какие запросы до
// него дошли. Нарушение должно остановиться ДО клиента (ADR-0006); то же на настоящей базе — *.int.test.ts.
import { testHouseholdId, testScope } from "@kosht/testing";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { fxReceipts, fxSettings } from "./__fixtures__/schema.ts";
import { IsolationViolation } from "./audit.ts";
import { crossTenant } from "./cross-tenant.ts";
import { createScopedDb } from "./scoped-db.ts";
import { createSystemDb } from "./system-db.ts";

const scopeA = testScope({ user: 1, household: 1 });
const B = testHouseholdId(2);

/** Клиент-счётчик: drizzle node-postgres вызывает client.query(конфиг, параметры). */
function countingClient() {
  const sent: { text: string; params: unknown[] }[] = [];
  const client = {
    query: async (config: { text: string }, params: unknown[] = []) => {
      sent.push({ text: config.text, params });
      return { rows: [], rowCount: 0, command: "SELECT", fields: [] };
    },
  };
  return { sent, client: client as unknown as pg.Pool };
}

describe("ScopedDb: insert, update, delete ставят владельца и фильтр сами", () => {
  it("insert берёт household_id и user_id из scope, даже если чужие переданы в обход типов", async () => {
    const { sent, client } = countingClient();
    const s = createScopedDb(client, scopeA);
    const sneaky = { merchant: "m", totalMinor: 100, householdId: B } as {
      merchant: string;
      totalMinor: number;
    };
    await s.insert(fxReceipts).values([sneaky, { merchant: "m2", totalMinor: 5 }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.params).toEqual([
      scopeA.householdId,
      scopeA.userId,
      "m",
      100,
      scopeA.householdId,
      scopeA.userId,
      "m2",
      5,
    ]);
  });

  it("update добавляет фильтр домохозяйства и не меняет владельца, id и created_at", async () => {
    const { sent, client } = countingClient();
    const s = createScopedDb(client, scopeA);
    const patch = { status: "ok", householdId: B, id: "x" } as { status: string };
    await s.update(fxReceipts, eq(fxReceipts.id, "r1")).set(patch);
    // В SET — только status (и updated_at от базы), владелец и id не меняются; фильтр — своё домохозяйство.
    expect(sent[0]?.text).toMatch(/ set "updated_at" = now\(\), "status" = \$1 where /);
    expect(sent[0]?.text).toContain('"fx_receipts"."household_id" = $2');
    expect(sent[0]?.params).toEqual(["ok", scopeA.householdId, "r1"]);
  });

  it("delete добавляет фильтр домохозяйства", async () => {
    const { sent, client } = countingClient();
    await createScopedDb(client, scopeA).delete(fxReceipts, eq(fxReceipts.id, "r1"));
    expect(sent[0]?.params).toEqual([scopeA.householdId, "r1"]);
  });
});

describe("ScopedDb: нарушение не доходит до базы", () => {
  it("чтение без s.own — ISOLATION_VIOLATION, клиент не получил ни одного запроса", async () => {
    const { sent, client } = countingClient();
    const s = createScopedDb(client, scopeA);
    await expect(
      s.db.select().from(fxReceipts).where(eq(fxReceipts.id, "r1")),
    ).rejects.toBeInstanceOf(IsolationViolation);
    expect(sent).toEqual([]);
  });

  it("канарейка механизма: тот же запрос через drizzle() без аудитора уходит в базу", async () => {
    const { sent, client } = countingClient();
    await drizzle({ client }).select().from(fxReceipts).where(eq(fxReceipts.id, "r1"));
    expect(sent).toHaveLength(1);
  });

  it("$client закрыт: обойти аудитор сырым pg нельзя", () => {
    const { client } = countingClient();
    const s = createScopedDb(client, scopeA);
    // @ts-expect-error у s.db нет $client: сырой pg мимо аудитора (ADR-0006)
    expect(() => s.db.$client).toThrow(/\$client недоступен/);
  });

  it("транзакция: begin проходит, нарушение отменяет запрос и откатывает транзакцию", async () => {
    const { sent, client } = countingClient();
    const s = createScopedDb(client, scopeA);
    await expect(
      s.transaction(async (tx) => {
        await tx.db.select().from(fxReceipts);
      }),
    ).rejects.toBeInstanceOf(IsolationViolation);
    expect(sent.map((q) => q.text)).toEqual(["begin", "rollback"]);
  });

  it("вложенная транзакция — SAVEPOINT; запросы внутри проходят аудитор", async () => {
    const { sent, client } = countingClient();
    const s = createScopedDb(client, scopeA);
    await s.transaction(async (tx) => {
      await tx.transaction(async (inner) => {
        await inner.db.select().from(fxReceipts).where(inner.own(fxReceipts));
        await expect(inner.db.select().from(fxReceipts)).rejects.toBeInstanceOf(IsolationViolation);
      });
    });
    expect(sent.map((q) => q.text.split(" ")[0])).toEqual([
      "begin",
      "savepoint",
      "select",
      "release",
      "commit",
    ]);
  });
});

describe("ScopedDb: типы не дают передать владельца (замок 1)", () => {
  it("householdId в insert и update, системная таблица в own и выключатель аудита не компилируются", () => {
    const { client } = countingClient();
    const s = createScopedDb(client, scopeA);
    const compileOnly = () => {
      // @ts-expect-error householdId ставит ScopedDb, передать его нельзя
      void s.insert(fxReceipts).values({ merchant: "m", totalMinor: 1, householdId: B });
      // @ts-expect-error userId ставит ScopedDb, передать его нельзя
      void s.insert(fxReceipts).values({ merchant: "m", totalMinor: 1, userId: scopeA.userId });
      // @ts-expect-error владельца строки update не меняет
      void s.update(fxReceipts, eq(fxReceipts.id, "x")).set({ householdId: B });
      // @ts-expect-error fx_settings — системная таблица, не userOwnedTable
      void s.own(fxSettings);
      // @ts-expect-error у боевой фабрики нет выключателя аудита
      void createScopedDb(client, scopeA, { audit: false });
    };
    expect(compileOnly).toBeTypeOf("function");
  });
});

describe("SystemDb и crossTenant", () => {
  it("SystemDb: пользовательская таблица — нарушение до базы, системная — проходит", async () => {
    const { sent, client } = countingClient();
    const system = createSystemDb(client);
    await expect(system.select().from(fxReceipts)).rejects.toMatchObject({
      reason: "SYSTEM_TOUCHES_USER_DATA",
    });
    await system.select().from(fxSettings);
    expect(sent).toHaveLength(1);
  });

  it("crossTenant: только (id, household_id, user_id); шире — нарушение до базы", async () => {
    const { sent, client } = countingClient();
    await crossTenant(client, "fx.stuck", (db) =>
      db
        .select({
          id: fxReceipts.id,
          householdId: fxReceipts.householdId,
          userId: fxReceipts.userId,
        })
        .from(fxReceipts)
        .where(eq(fxReceipts.status, "recognizing")),
    );
    await expect(
      crossTenant(
        client,
        "fx.leak",
        (db) => db.select({ id: fxReceipts.id, note: fxReceipts.note }).from(fxReceipts) as never,
      ),
    ).rejects.toMatchObject({ reason: "CROSS_TENANT_COLUMNS" });
    expect(sent).toHaveLength(1);
  });

  it("crossTenant без имени обхода — ошибка", async () => {
    const { client } = countingClient();
    await expect(crossTenant(client, " ", async () => [])).rejects.toThrow(/имя обхода/);
  });
});
