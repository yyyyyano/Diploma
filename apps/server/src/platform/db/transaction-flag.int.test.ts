// ARCHITECTURE §4.3: флаг транзакции ScopedDb — поднят только внутри s.transaction (и вложенной), не протекает в
// параллельный код и опускается после коммита и отката.
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb } from "./scoped-db.ts";
import { inTransaction } from "./transaction-flag.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("флаг транзакции ScopedDb", () => {
  it("вне транзакции — нет; внутри и во вложенной — да; после коммита — снова нет", async () => {
    const s = createScopedDb(db.pool, testScope());
    expect(inTransaction()).toBe(false);
    const seen = await s.transaction(async (tx) => {
      const outer = inTransaction();
      const nested = await tx.transaction(async () => inTransaction());
      return { outer, nested };
    });
    expect(seen).toEqual({ outer: true, nested: true });
    expect(inTransaction()).toBe(false);
  });

  it("откат — флаг опущен; параллельный код вне транзакции его не видит", async () => {
    const s = createScopedDb(db.pool, testScope());
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failing = s.transaction(async () => {
      await gate;
      throw new Error("откат");
    });
    const outside = (async () => {
      const value = inTransaction();
      release();
      return value;
    })();
    expect(await outside).toBe(false);
    await expect(failing).rejects.toThrow("откат");
    expect(inTransaction()).toBe(false);
  });
});
