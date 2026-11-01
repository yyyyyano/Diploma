// XLS-01…04, AGT-03 сквозь HTTP на настоящем Postgres: «Выгрузить в Excel» отдаёт книгу за период — операции, сводка с кэш-результатами
// формул и лимиты; чужие данные в файл не попадают, гость получает 401, неверный период — 400; инструмент `export_excel` возвращает ссылку.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeScope } from "@kosht/kernel";
import { registerUser, startHttpStack, type HttpStack } from "./__fixtures__/http-stack.ts";

let db: TestDb;
let stack: HttpStack;
beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db, { worker: false });
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

/** Стенд идёт на настоящих часах: операции кладём на первое число текущего месяца — оно не позже «сегодня». */
const now = new Date();
const month = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const first = `${month}-01`;
const byn = (minor: number) => ({ minor, currency: "BYN" });

async function post(cookie: string, path: string, body: unknown) {
  const response = await stack.call("local", path, { cookie, body });
  expect(response.status, `${path}: ${await response.clone().text()}`).toBe(200);
}

async function seed(cookie: string) {
  const expense = (merchant: string, minor: number, code: string) =>
    post(cookie, "/transactions", {
      type: "expense",
      occurredOn: first,
      amount: byn(minor),
      merchant,
      category: { type: "system", code },
    });
  await expense("Евроопт", 1000, "groceries");
  await expense("Евроопт", 847, "groceries");
  await expense("Кофейня", 1200, "cafes");
  await post(cookie, "/transactions", {
    type: "income",
    occurredOn: first,
    amount: byn(300_000),
    merchant: "Работодатель",
    category: { type: "system", code: "salary" },
  });
  await post(cookie, "/budgets/limit", { categoryKey: "system:groceries", limit: byn(10_000) });
}

async function download(cookie: string, query = "") {
  const response = await stack.call("local", `/xls-export${query}`, { cookie });
  return response;
}

async function open(response: Response): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.arrayBuffer());
  return book;
}

describe("XLS-01, XLS-02: выгрузка за период", () => {
  it("по умолчанию — текущий месяц: три листа, операции, итоги сводки и лимит", async () => {
    const user = await registerUser(stack, db, "xls-owner@example.test");
    await seed(user.cookie);
    const response = await download(user.cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="kosht-\d{4}-\d{2}-01_\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    const book = await open(response);
    expect(book.worksheets.map((s) => s.name)).toEqual(["Операции", "Сводка", "Лимиты"]);
    const operations = book.getWorksheet("Операции");
    expect(operations?.actualRowCount).toBe(5);
    const summary = book.getWorksheet("Сводка");
    const rows = new Map<string, number>();
    summary?.eachRow((row) => {
      const name = row.getCell(1).value;
      const result = (row.getCell(2).value as { result?: number } | null)?.result;
      if (typeof name === "string") rows.set(name, result ?? 0);
    });
    expect(rows.get("Продукты")).toBeCloseTo(18.47, 6);
    expect(rows.get("Кафе, рестораны и доставка")).toBeCloseTo(12, 6);
    expect(rows.get("Расходы")).toBeCloseTo(30.47, 6);
    expect(rows.get("Доходы")).toBeCloseTo(3000, 6);
    const limits = book.getWorksheet("Лимиты");
    expect(limits?.getCell("A2").value).toBe("Продукты");
    expect(limits?.getCell("D2").value).toMatchObject({ result: 18 });
  });

  it("чужие операции в файл не попадают: у другого пользователя лист пуст", async () => {
    const stranger = await registerUser(stack, db, "xls-stranger@example.test");
    const book = await open(await download(stranger.cookie));
    expect(book.getWorksheet("Операции")?.actualRowCount).toBe(1);
  });

  it("гость получает 401", async () => {
    const response = await stack.call("local", "/xls-export");
    expect(response.status).toBe(401);
  });

  it("начало позже конца и слишком длинный период — 400", async () => {
    const user = await registerUser(stack, db, "xls-validation@example.test");
    expect((await download(user.cookie, "?from=2026-10-05&to=2026-10-01")).status).toBe(400);
    expect((await download(user.cookie, "?from=2000-01-01&to=2026-10-01")).status).toBe(400);
    expect((await download(user.cookie, "?from=вчера")).status).toBe(400);
  });
});

describe("AGT-03: инструмент export_excel", () => {
  it("возвращает ссылку на скачивание за период и число операций", async () => {
    const user = await registerUser(stack, db, "xls-tool@example.test");
    await seed(user.cookie);
    const module = stack.api.modules.find((m) => m.id === "xls-export");
    const tool = module?.tools.find((t) => t.name === "export_excel");
    expect(tool?.kind).toBe("read");
    expect(tool?.toolset).toBe("reports");
    if (tool === undefined || tool.kind !== "read") throw new Error("нет export_excel");
    const result = await tool.execute(
      {
        s: stack.api.platform.scoped(makeScope(user)),
        requestId: "r1",
        channel: "web",
      },
      { from: first, to: first } as never,
    );
    expect(result).toEqual({
      from: first,
      to: first,
      operations: 4,
      url: `/api/xls-export?from=${first}&to=${first}`,
    });
  });
});
