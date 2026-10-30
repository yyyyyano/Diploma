// RCPT-03, RCPT-04, ROLE-01: запросы к чекам на Postgres — позиции и попытки по порядку, замена позиций, поиск дубля по УИ и по
// ключу «магазин + день + время + итог» только в своём домохозяйстве, нарушение уникального индекса распознаётся.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newScope } from "../../../../main/__fixtures__/transactions-with-journal.ts";
import {
  findByKey,
  findByUid,
  findReceipt,
  insertAttempt,
  insertReceipt,
  isUniqueViolation,
  listAttempts,
  listItems,
  lockReceipt,
  replaceItems,
  updateReceipt,
} from "./receipts.repo.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const item = (position: number, name: string) => ({
  position,
  name,
  normalizedName: name.toLowerCase(),
  unit: null,
  quantityMilli: 1000,
  unitPriceMinor: 100,
  discountMinor: 0,
  lineTotalMinor: 100,
  disputed: false,
});

describe("позиции и попытки", () => {
  it("позиции и попытки читаются по порядку; замена позиций убирает прежние", async () => {
    const s = newScope(db);
    const receipt = await insertReceipt(s, { fileId: randomUUID(), status: "processing" });
    await replaceItems(s, receipt.id, [item(2, "Б"), item(1, "А")]);
    expect((await listItems(s, receipt.id)).map((row) => row.name)).toEqual(["А", "Б"]);
    await replaceItems(s, receipt.id, [item(1, "В")]);
    expect((await listItems(s, receipt.id)).map((row) => row.name)).toEqual(["В"]);
    await replaceItems(s, receipt.id, []);
    expect(await listItems(s, receipt.id)).toEqual([]);
    await insertAttempt(s, receipt.id, {
      attempt: 1,
      ok: true,
      askedLines: [2],
      changedLines: [2],
    });
    await insertAttempt(s, receipt.id, { attempt: 0, ok: false });
    expect((await listAttempts(s, receipt.id)).map((row) => [row.attempt, row.ok])).toEqual([
      [0, false],
      [1, true],
    ]);
  });
});

describe("дубли и изоляция", () => {
  it("УИ ищется только среди чужих по номеру чеков и только в своём домохозяйстве", async () => {
    const mine = newScope(db);
    const theirs = newScope(db);
    const first = await insertReceipt(mine, {
      fileId: randomUUID(),
      status: "ok",
      uid: "A".repeat(24),
    });
    const second = await insertReceipt(mine, { fileId: randomUUID(), status: "processing" });
    expect((await findByUid(mine, "A".repeat(24), second.id))?.id).toBe(first.id);
    expect(await findByUid(mine, "A".repeat(24), first.id)).toBeUndefined();
    expect(await findByUid(theirs, "A".repeat(24), second.id)).toBeUndefined();
    expect(await findReceipt(theirs, first.id)).toBeUndefined();
  });

  it("тот же УИ второй раз в домохозяйстве — нарушение уникального индекса, у другого домохозяйства — нет", async () => {
    const mine = newScope(db);
    const theirs = newScope(db);
    await insertReceipt(mine, { fileId: randomUUID(), status: "ok", uid: "B".repeat(24) });
    await insertReceipt(theirs, { fileId: randomUUID(), status: "ok", uid: "B".repeat(24) });
    const failure = await insertReceipt(mine, {
      fileId: randomUUID(),
      status: "ok",
      uid: "B".repeat(24),
    }).catch((error: unknown) => error);
    expect(isUniqueViolation(failure)).toBe(true);
  });

  it("ключ «магазин + день + время + итог» находит сохранённый чек, но не «не вышло» и не «распознаётся»", async () => {
    const s = newScope(db);
    const key = { storeKey: "СОСНОВЫЙ", date: "2026-10-12", time: "14:37:22", totalMinor: 2346 };
    const patch = {
      storeKey: key.storeKey,
      purchaseDate: key.date,
      purchaseTime: key.time,
      totalMinor: key.totalMinor,
    };
    const asker = await insertReceipt(s, { fileId: randomUUID(), status: "processing" });
    const original = await insertReceipt(s, { fileId: randomUUID(), status: "ok", ...patch });
    expect((await findByKey(s, key, asker.id))?.id).toBe(original.id);
    await updateReceipt(s, original.id, { status: "failed" });
    expect(await findByKey(s, key, asker.id)).toBeUndefined();
    await updateReceipt(s, original.id, { status: "processing" });
    expect(await findByKey(s, key, asker.id)).toBeUndefined();
    await updateReceipt(s, original.id, { status: "needs-review" });
    expect((await findByKey(s, key, asker.id))?.id).toBe(original.id);
    expect(await findByKey(s, { ...key, totalMinor: 1 }, asker.id)).toBeUndefined();
  });

  it("блокировка строки отдаёт свой чек; чужой и неизвестный — ничего", async () => {
    const mine = newScope(db);
    const theirs = newScope(db);
    const receipt = await insertReceipt(mine, { fileId: randomUUID(), status: "processing" });
    expect((await mine.transaction((tx) => lockReceipt(tx, receipt.id)))?.id).toBe(receipt.id);
    expect(await theirs.transaction((tx) => lockReceipt(tx, receipt.id))).toBeUndefined();
  });
});

describe("isUniqueViolation", () => {
  it("код 23505 в самой ошибке или в её причине — да; другое — нет", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error("обёртка", { cause: { code: "23505" } }))).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(new Error("прочее"))).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
