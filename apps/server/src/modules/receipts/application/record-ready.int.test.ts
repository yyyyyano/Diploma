// DEMO-01 на стороне receipts: готовое чтение чека (без модели и без фото-распознавания) записывается теми же валидатором,
// перепроверкой, планом операции и транзакцией, что и распознанный чек (RCPT-05…10): статусы «сходится», «перепроверка»,
// «требует проверки» получаются арифметикой, а не выдаются руками. Категории позиций заданы явно — модель не вызывается.
import { FileId } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  newScope,
  transactionsWithJournal,
} from "../../../main/__fixtures__/transactions-with-journal.ts";
import { scriptedLlm, testSettings } from "../__fixtures__/scripted-llm.ts";
import { makeRecognize } from "./recognize.ts";
import { makeRecordReady, type ReadyReceipt } from "./record-ready.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

function setup() {
  const t = transactionsWithJournal(db);
  const notices: { kind: string; key: string }[] = [];
  const script = scriptedLlm([]);
  const flow = makeRecognize({
    platform: { ...t.platform, settings: testSettings() } as never,
    files: {} as never,
    llm: script.llm,
    merchants: t.merchants,
    explain: t.explain,
    categories: t.categories,
    transactions: t.ops,
    notifications: {
      notify: async (_s, input) => {
        notices.push({ kind: input.kind, key: input.key });
        return randomUUID();
      },
    },
    preparer: {} as never,
    jobs: { recognize: { name: "receipts.recognize" } as never },
  });
  const recordReady = makeRecordReady({
    platform: { ...t.platform, settings: testSettings() } as never,
    merchants: t.merchants,
    transactions: t.ops,
    settle: flow.settle,
  });
  const row = async (householdId: string, id: string) =>
    (
      await db.owner.query(
        `select *, purchase_date::text as purchase_date from receipts where household_id = $1 and id = $2`,
        [householdId, id],
      )
    ).rows[0] as Record<string, unknown>;
  const rows = async (table: string, householdId: string, id: string) =>
    (
      await db.owner.query(
        `select * from ${table} where household_id = $1 and receipt_id = $2 order by ${table === "receipt_items" ? "position" : "attempt"}`,
        [householdId, id],
      )
    ).rows as Record<string, unknown>[];
  return { t, notices, script, recordReady, row, rows };
}

const line = (name: string, quantity: string, unitPrice: string, lineTotal: string) => ({
  name,
  quantity,
  unit: "шт",
  unitPrice,
  discount: null,
  lineTotal,
});

function reading(over: Partial<ReadyReceipt["reading"]> = {}): ReadyReceipt["reading"] {
  return {
    store: "ООО «Сосновый»",
    unp: "190123456",
    address: "г. Минск, ул. Весенняя, 12",
    date: "12.10.2026",
    time: "14:37:22",
    currency: "BYN",
    items: [
      line("Хлеб Нарочанский 400г", "1", "10,99", "10,99"),
      line("Молоко 3,2% 1л", "3", "2,49", "7,47"),
      line("Шампунь 400мл", "1", "5,00", "5,00"),
    ],
    receiptDiscount: null,
    total: "23,46",
    payment: "card",
    cardLast4: "4417",
    uid: null,
    ...over,
  };
}

const fileOf = () => FileId.parse(randomUUID());

describe("DEMO-01: готовое чтение чека", () => {
  it("чек сходится: статус «сходится», позиции с заданными категориями, операция с разбивкой, модель не вызывалась", async () => {
    const s = newScope(db);
    const stand = setup();
    const { id, status } = await stand.recordReady(s, {
      fileId: fileOf(),
      reading: reading(),
      rechecks: [],
      categories: ["groceries", "groceries", "beauty"],
    });
    expect(status).toBe("ok");
    expect(await stand.row(s.scope.householdId, id)).toMatchObject({
      status: "ok",
      rechecks: 0,
      total_minor: "2346",
      store_name: "ООО «Сосновый»",
      purchase_date: "2026-10-12",
      card_last4: "4417",
    });
    const items = await stand.rows("receipt_items", s.scope.householdId, id);
    expect(items.map((item) => item["category_code"])).toEqual([
      "groceries",
      "groceries",
      "beauty",
    ]);
    expect(stand.script.calls).toHaveLength(0);
    const operations = await db.owner.query(
      `select amount_minor, pending from transactions where household_id = $1 and receipt_id = $2`,
      [s.scope.householdId, id],
    );
    expect(operations.rows).toMatchObject([{ amount_minor: "2346", pending: true }]);
    const splits = await db.owner.query(
      `select category_code, amount_minor from transaction_splits where household_id = $1 order by amount_minor desc`,
      [s.scope.householdId],
    );
    expect(splits.rows).toMatchObject([
      { category_code: "groceries", amount_minor: "1846" },
      { category_code: "beauty", amount_minor: "500" },
    ]);
  });

  it("RCPT-06: строка 2 прочитана как 8,47, готовая перепроверка называет 7,47 — «сходится», в истории одна перепроверка строки 2", async () => {
    const s = newScope(db);
    const stand = setup();
    const misread = reading();
    misread.items[1] = line("Молоко 3,2% 1л", "3", "2,49", "8,47");
    const { id, status } = await stand.recordReady(s, {
      fileId: fileOf(),
      reading: misread,
      rechecks: [
        {
          lines: [{ line: 2, quantity: "3", unitPrice: "2,49", discount: null, lineTotal: "7,47" }],
          total: null,
          receiptDiscount: null,
        },
      ],
      categories: ["groceries", "groceries", "beauty"],
    });
    expect(status).toBe("ok");
    expect(await stand.row(s.scope.householdId, id)).toMatchObject({ status: "ok", rechecks: 1 });
    expect(await stand.rows("receipt_attempts", s.scope.householdId, id)).toMatchObject([
      { attempt: 0, ok: false, asked_lines: [], changed_lines: [] },
      { attempt: 1, ok: true, asked_lines: [2], changed_lines: [2] },
    ]);
    expect((await stand.rows("receipt_items", s.scope.householdId, id))[1]).toMatchObject({
      line_total_minor: "747",
    });
  });

  it("RCPT-07: перепроверка не помогла — «требует проверки», спорная строка названа, уведомление одно", async () => {
    const s = newScope(db);
    const stand = setup();
    const misread = reading();
    misread.items[1] = line("Молоко 3,2% 1л", "3", "2,49", "8,47");
    const same = {
      lines: [{ line: 2, quantity: "3", unitPrice: "2,49", discount: null, lineTotal: "8,47" }],
      total: null,
      receiptDiscount: null,
    };
    const { id, status } = await stand.recordReady(s, {
      fileId: fileOf(),
      reading: misread,
      rechecks: [same, same],
      categories: ["groceries", "groceries", "beauty"],
    });
    expect(status).toBe("needs-review");
    expect(await stand.row(s.scope.householdId, id)).toMatchObject({
      status: "needs-review",
      disputed_lines: [2],
      rechecks: 2,
    });
    expect(stand.notices).toEqual([{ kind: "receipt-review", key: id }]);
  });

  it("число категорий не совпадает с числом позиций — VALIDATION, чек не создаётся", async () => {
    const s = newScope(db);
    const stand = setup();
    await expect(
      stand.recordReady(s, {
        fileId: fileOf(),
        reading: reading(),
        rechecks: [],
        categories: ["groceries"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const rows = await db.owner.query(`select 1 from receipts where household_id = $1`, [
      s.scope.householdId,
    ]);
    expect(rows.rows).toHaveLength(0);
  });
});
