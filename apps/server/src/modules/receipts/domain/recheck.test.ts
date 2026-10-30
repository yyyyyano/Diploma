// RCPT-06: перепроверка вливается только в спорные места; наименования и чужие строки не трогаются.
import { describe, expect, it } from "vitest";
import { applyRecheck, askedOf } from "./recheck.ts";
import type { PrintedItem, PrintedReceipt } from "./types.ts";

const item = (name: string, over: Partial<PrintedItem> = {}): PrintedItem => ({
  name,
  quantity: "1",
  unit: "шт",
  unitPrice: "1,00",
  discount: null,
  lineTotal: "1,00",
  ...over,
});

const receipt: PrintedReceipt = {
  items: [item("А"), item("Б", { quantity: "3", unitPrice: "2,49", lineTotal: "8,47" }), item("В")],
  receiptDiscount: "1,00",
  total: "10,47",
};

describe("RCPT-06: что спрашивали", () => {
  it("спорные строки без повторов по порядку и признак спорного итога", () => {
    expect(
      askedOf([
        { kind: "line", line: 3, reason: "unreadable" },
        { kind: "line", line: 2, reason: "arithmetic", expectedMinor: 747, printedMinor: 847 },
        { kind: "total", reason: "unreadable" },
      ]),
    ).toEqual({ lines: [2, 3], total: true });
  });
});

describe("RCPT-06: слияние ответа перепроверки", () => {
  it("исправленная строка 2 заменяется, а наименование остаётся прежним", () => {
    const merged = applyRecheck(
      receipt,
      {
        lines: [{ line: 2, quantity: "3", unitPrice: "2,49", discount: null, lineTotal: "7,47" }],
        total: null,
        receiptDiscount: null,
      },
      { lines: [2], total: false },
    );
    expect(merged.printed.items[1]).toMatchObject({ name: "Б", lineTotal: "7,47" });
    expect(merged.changedLines).toEqual([2]);
  });

  it("строка, которую не спрашивали, не меняется, даже если модель её вернула", () => {
    const merged = applyRecheck(
      receipt,
      {
        lines: [{ line: 3, quantity: "9", unitPrice: "9,00", discount: null, lineTotal: "81,00" }],
        total: null,
        receiptDiscount: null,
      },
      { lines: [2], total: false },
    );
    expect(merged.printed.items[2]).toEqual(receipt.items[2]);
    expect(merged.changedLines).toEqual([]);
  });

  it("несуществующий номер строки отбрасывается", () => {
    const merged = applyRecheck(
      receipt,
      {
        lines: [{ line: 9, quantity: "1", unitPrice: "1,00", discount: null, lineTotal: "1,00" }],
        total: null,
        receiptDiscount: null,
      },
      { lines: [9], total: false },
    );
    expect(merged.printed.items).toEqual(receipt.items);
  });

  it("итог и скидки на чек перечитываются только если итог был спорным", () => {
    const answer = {
      lines: [],
      total: "9,47",
      receiptDiscount: "2,00",
    };
    expect(applyRecheck(receipt, answer, { lines: [], total: false }).printed).toMatchObject({
      total: "10,47",
      receiptDiscount: "1,00",
    });
    expect(applyRecheck(receipt, answer, { lines: [], total: true }).printed).toMatchObject({
      total: "9,47",
      receiptDiscount: "2,00",
    });
  });

  it("итог без нового значения остаётся прежним", () => {
    const merged = applyRecheck(
      receipt,
      { lines: [], total: null, receiptDiscount: null },
      { lines: [], total: true },
    );
    expect(merged.printed.total).toBe("10,47");
  });

  it("тот же ответ строки — не изменение", () => {
    const merged = applyRecheck(
      receipt,
      {
        lines: [{ line: 2, quantity: "3", unitPrice: "2,49", discount: null, lineTotal: "8,47" }],
        total: null,
        receiptDiscount: null,
      },
      { lines: [2], total: false },
    );
    expect(merged.changedLines).toEqual([]);
  });
});
