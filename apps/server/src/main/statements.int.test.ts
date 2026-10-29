// STMT-03, STMT-04, SEC-03 сквозь корень композиции: загруженный и сохранённый файлом домохозяйства файл выписки
// читается настоящим потоком, колонки определяются без модели, чужой файл недоступен. Фасады files и statements — из
// собранного приложения, база — настоящая.
import { FileId, makeScope } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FilesFacade } from "../modules/files/index.ts";
import type { StatementsFacade } from "../modules/statements/index.ts";
import { registerUser, startHttpStack, type HttpStack } from "./__fixtures__/http-stack.ts";

let db: TestDb;
let stack: HttpStack;
beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db);
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

function facade<T>(id: string): T {
  const module = stack.api.modules.find((m) => m.id === id);
  if (module === undefined) throw new Error(`нет модуля ${id}`);
  return module.facade as T;
}

const dataset = (id: string, file: string) =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../../../../datasets/statements/${id}/${file}`, import.meta.url)),
    ),
  );

describe("STMT-04: разбор загруженной выписки через собранное приложение", () => {
  it("CSV и PDF из хранилища файлов: операции, остатки сходятся, модель не нужна", async () => {
    const user = await registerUser(stack, db, "statements-ok@example.test");
    const s = stack.api.platform.scoped(makeScope(user));
    const files = facade<FilesFacade>("files");
    const statements = facade<StatementsFacade>("statements");

    const csv = await files.save(s, {
      kind: "statement",
      name: "сентябрь.csv",
      mime: "text/csv",
      content: dataset("lesbank-csv-september", "statement.csv"),
    });
    const fromCsv = await statements.parseStatement(s, csv.id);
    expect(fromCsv).toMatchObject({
      method: "detected",
      currency: "BYN",
      bank: "Лесбанк",
      accountMask: "4821",
    });
    expect(fromCsv.rows).toHaveLength(30);
    expect(fromCsv.balance.status).toBe("ok");

    const pdf = await files.save(s, {
      kind: "statement",
      name: "выписка.pdf",
      mime: "application/pdf",
      content: dataset("lesbank-pdf-multipage", "statement.pdf"),
    });
    const fromPdf = await statements.parseStatement(s, pdf.id);
    expect(fromPdf.rows).toHaveLength(100);
    expect(fromPdf.balance.status).toBe("ok");
  });

  it("запомнить формат и разобрать вторую выписку: метод «remembered»", async () => {
    const user = await registerUser(stack, db, "statements-remember@example.test");
    const s = stack.api.platform.scoped(makeScope(user));
    const files = facade<FilesFacade>("files");
    const statements = facade<StatementsFacade>("statements");
    const save = (id: string) =>
      files.save(s, {
        kind: "statement",
        name: "выписка.csv",
        mime: "text/csv",
        content: dataset(id, "statement.csv"),
      });
    const first = await statements.parseStatement(s, (await save("lesbank-csv-september")).id);
    await statements.rememberFormat(s, first);
    const second = await statements.parseStatement(s, (await save("lesbank-csv-october")).id);
    expect(second.method).toBe("remembered");
  });

  it("чужой файл — NOT_FOUND, файл не из белого списка — STATEMENT_UNREADABLE", async () => {
    const owner = await registerUser(stack, db, "statements-owner@example.test");
    const stranger = await registerUser(stack, db, "statements-stranger@example.test");
    const files = facade<FilesFacade>("files");
    const statements = facade<StatementsFacade>("statements");
    const ownerScope = stack.api.platform.scoped(makeScope(owner));
    const saved = await files.save(ownerScope, {
      kind: "statement",
      name: "a.csv",
      mime: "text/csv",
      content: dataset("lesbank-csv-september", "statement.csv"),
    });
    await expect(
      statements.parseStatement(stack.api.platform.scoped(makeScope(stranger)), saved.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const odd = await files.save(ownerScope, {
      kind: "statement",
      name: "a.bin",
      mime: "application/octet-stream",
      content: new Uint8Array([1, 2, 3]),
    });
    await expect(statements.parseStatement(ownerScope, odd.id)).rejects.toMatchObject({
      code: "STATEMENT_UNREADABLE",
    });
    // Несуществующий id — тот же NOT_FOUND.
    await expect(
      statements.parseStatement(ownerScope, FileId.parse("019a0000-0000-7000-8000-000000000000")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
