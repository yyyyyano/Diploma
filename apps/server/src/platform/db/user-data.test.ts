// PRIV-05, PRIV-06, ARCHITECTURE §6.6: владелец данных — какие пользовательские таблицы модуля выгружаются в
// «Мои данные» и удаляются вместе с аккаунтом. Порядок — дети раньше родителей (составные FK).
import { describe, expect, it } from "vitest";
import { fxReceiptItems, fxReceipts, fxSettings } from "./__fixtures__/schema.ts";
import type { OwnedTable } from "./tables.ts";
import { defineUserData } from "./user-data.ts";

describe("PRIV-06: defineUserData", () => {
  it("хранит таблицы и их имена в порядке удаления — дети раньше родителей", () => {
    const data = defineUserData({ tables: [fxReceiptItems, fxReceipts] });
    expect(data.tableNames).toEqual(["fx_receipt_items", "fx_receipts"]);
    expect(data.tables).toEqual([fxReceiptItems, fxReceipts]);
  });

  it("пустой список — ошибка: модуль без пользовательских таблиц владельцем данных не бывает", () => {
    expect(() => defineUserData({ tables: [] })).toThrow(/хотя бы одна/);
  });

  it("таблица дважды — ошибка с её именем", () => {
    expect(() => defineUserData({ tables: [fxReceipts, fxReceipts] })).toThrow(/fx_receipts/);
  });

  it("системная таблица не принимается ни по типу, ни при определении", () => {
    // @ts-expect-error владелец данных перечисляет только userOwnedTable (ROLE-01)
    const tables: OwnedTable[] = [fxSettings];
    expect(() => defineUserData({ tables })).toThrow(/fx_settings/);
  });
});
