// T-027, NFR-18, QA-11: набор datasets/receipts — ровно то, что даёт генератор, а эталон внутренне согласован.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { Expected } from "./cases.ts";
import { writeDataset } from "./generate.ts";

const committed = fileURLToPath(new URL("../../../datasets/receipts/", import.meta.url));
const fresh = mkdtempSync(join(tmpdir(), "kosht-synth-receipts-"));
afterAll(() => rmSync(fresh, { recursive: true, force: true }));

const caseIds = () => readdirSync(committed).filter((name) => !name.endsWith(".md"));
const expectedOf = (dir: string, id: string) =>
  JSON.parse(readFileSync(join(dir, id, "expected.json"), "utf8")) as Expected;
const photoOf = (dir: string, id: string) =>
  readdirSync(join(dir, id)).find((file) => file.startsWith("receipt.")) ?? "";

/** «8,47» → 847, «-0,60» → −60. */
const minor = (text: string) => Math.round(Number(text.replace(",", ".")) * 100);

describe("синтетические чеки", () => {
  it("набор в репозитории совпадает с генератором: те же случаи и эталоны", async () => {
    const ids = await writeDataset(fresh);
    expect(caseIds().toSorted()).toEqual(ids.toSorted());
    const changed = ids.filter(
      (id) => JSON.stringify(expectedOf(committed, id)) !== JSON.stringify(expectedOf(fresh, id)),
    );
    expect(changed).toEqual([]);
  }, 120_000);

  it("файлы набора устарели, если байты не совпали: make synth-receipts", () => {
    const stale = caseIds().filter((id) => {
      const name = photoOf(committed, id);
      return !readFileSync(join(committed, id, name)).equals(readFileSync(join(fresh, id, name)));
    });
    expect(stale).toEqual([]);
  });

  it("эталон арифметики пересчитывается из напечатанных строк: итог, спорные строки, разницы", () => {
    const wrong = caseIds().filter((id) => {
      const e = expectedOf(committed, id);
      const linesSum = e.items.reduce((acc, item) => acc + minor(item.lineTotal), 0);
      const discount = e.receiptDiscount === null ? 0 : -minor(e.receiptDiscount);
      const totalOk = Math.abs(minor(e.total) - (linesSum - discount)) <= 1;
      const disputed = e.items
        .map((item, index) => {
          const milli = Math.round(Number(item.quantity.replace(",", ".")) * 1000);
          const gross = Math.round((minor(item.unitPrice) * milli) / 1000);
          const lineDiscount = item.discount === null ? 0 : -minor(item.discount);
          return Math.abs(minor(item.lineTotal) - (gross - lineDiscount)) > 1 ? index + 1 : 0;
        })
        .filter((index) => index > 0);
      return !(
        e.arithmetic.linesSumMinor === linesSum &&
        e.arithmetic.expectedTotalMinor === linesSum - discount &&
        e.arithmetic.printedTotalMinor === minor(e.total) &&
        e.arithmetic.totalOk === totalOk &&
        JSON.stringify(e.arithmetic.disputedLines) === JSON.stringify(disputed) &&
        e.arithmetic.ok === (disputed.length === 0 && totalOk)
      );
    });
    expect(wrong).toEqual([]);
  });

  it("случай из SPEC: 3 × 2,49 напечатано как 8,47 — спорная строка 2", () => {
    const e = expectedOf(committed, "sosnovy-typo-line2");
    expect(e.items[1]).toMatchObject({ quantity: "3", unitPrice: "2,49", lineTotal: "8,47" });
    expect(e.arithmetic.disputedLines).toEqual([2]);
  });

  it("в наборе есть чеки без QR, с нечитаемым QR, с опечатками, с приказом модели, PNG и JPEG; весь набор — до 5 МБ", () => {
    const all = caseIds().map((id) => expectedOf(committed, id));
    expect(all.some((e) => !e.qr.printed)).toBe(true);
    expect(all.some((e) => e.qr.printed && !e.qr.readable)).toBe(true);
    expect(all.some((e) => !e.arithmetic.ok)).toBe(true);
    expect(all.some((e) => e.injection)).toBe(true);
    const formats = new Set(caseIds().map((id) => photoOf(committed, id).split(".")[1]));
    expect(formats.has("png") && formats.has("jpg")).toBe(true);
    const size = caseIds().reduce(
      (acc, id) =>
        acc +
        readdirSync(join(committed, id)).reduce(
          (s, f) => s + statSync(join(committed, id, f)).size,
          0,
        ),
      0,
    );
    expect(size).toBeLessThan(5 * 1024 * 1024);
  });

  it("УИ у каждого случая свой и из 24 символов", () => {
    const uids = caseIds().map((id) => expectedOf(committed, id).uid);
    expect(new Set(uids).size).toBe(uids.length);
    expect(uids.every((uid) => /^[A-Z0-9]{24}$/.test(uid))).toBe(true);
  });
});
