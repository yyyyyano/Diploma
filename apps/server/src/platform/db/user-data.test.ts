// PRIV-05, PRIV-06, ARCHITECTURE §6.6: владелец данных — какие пользовательские таблицы модуля выгружаются в
// «Мои данные» и удаляются вместе с аккаунтом. Порядок — дети раньше родителей (составные FK).
import { testScope } from "@kosht/testing";
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

  it("пустой список без хуков — ошибка: такому модулю нечего выгружать и удалять", () => {
    expect(() => defineUserData({ tables: [] })).toThrow(/хотя бы одна/);
  });

  it("без таблиц, но с хуком удаления — владелец данных вне своих таблиц (трассы Langfuse)", async () => {
    const removed: string[] = [];
    const data = defineUserData({
      tables: [],
      afterDelete: async (scope) => {
        removed.push(scope.userId);
      },
    });
    expect(data.tableNames).toEqual([]);
    await data.afterDelete?.(testScope({ user: 1, household: 1 }));
    expect(removed).toEqual([testScope({ user: 1, household: 1 }).userId]);
  });

  it("хуки выгрузки и удаления хранятся рядом с таблицами", () => {
    const exportFiles = async () => {};
    const afterDelete = async () => {};
    const data = defineUserData({ tables: [fxReceipts], export: exportFiles, afterDelete });
    expect(data.export).toBe(exportFiles);
    expect(data.afterDelete).toBe(afterDelete);
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
