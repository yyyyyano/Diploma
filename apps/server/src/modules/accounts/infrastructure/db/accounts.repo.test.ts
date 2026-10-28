// STMT-01: удаление счёта — false только когда на него ссылаются операции (RESTRICT 23001 и NO ACTION 23503 в причине
// ошибки Drizzle); любая другая ошибка базы не глушится. Без БД: ScopedDb, чей delete отвечает заданной ошибкой.
import { describe, expect, it } from "vitest";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { deleteAccount } from "./accounts.repo.ts";

function failingDelete(error: unknown): ScopedDb {
  return { delete: () => Promise.reject(error) } as unknown as ScopedDb;
}

describe("STMT-01: удалить счёт с операциями нельзя", () => {
  it("ссылки операций (RESTRICT и NO ACTION в причине ошибки) — false, счёт остаётся", async () => {
    for (const code of ["23001", "23503"]) {
      const error = new Error("Failed query", { cause: Object.assign(new Error("fk"), { code }) });
      expect(await deleteAccount(failingDelete(error), "id")).toBe(false);
    }
  });

  it("другая ошибка базы не глушится", async () => {
    const lost = new Error("Failed query", {
      cause: Object.assign(new Error("lost"), { code: "57P01" }),
    });
    await expect(deleteAccount(failingDelete(lost), "id")).rejects.toBe(lost);
  });
});
