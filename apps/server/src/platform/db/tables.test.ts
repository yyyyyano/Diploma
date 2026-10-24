import { getTableName } from "drizzle-orm";
import { getTableConfig, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  fxRates,
  fxReceiptItems,
  fxReceipts,
  fxSettings,
  fxTransactions,
} from "./__fixtures__/schema.ts";
import {
  ownedTableNames,
  publicTable,
  registeredTables,
  systemTable,
  userOwnedTable,
} from "./tables.ts";

describe("ROLE-01: userOwnedTable — данные домохозяйства", () => {
  it("даёт id, household_id, user_id, created_at, updated_at и первичный ключ (household_id, id)", () => {
    const config = getTableConfig(fxReceipts);
    expect(config.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(["id", "household_id", "user_id", "created_at", "updated_at"]),
    );
    expect(config.primaryKeys.map((pk) => pk.columns.map((c) => c.name))).toEqual([
      ["household_id", "id"],
    ]);
  });

  it("household_id и user_id обязательны, id по умолчанию — uuidv7() базы", () => {
    const columns = new Map(getTableConfig(fxReceipts).columns.map((c) => [c.name, c]));
    expect(columns.get("household_id")?.notNull).toBe(true);
    expect(columns.get("user_id")?.notNull).toBe(true);
    expect(columns.get("id")?.hasDefault).toBe(true);
  });

  it("имена колонок — snake_case из имён свойств: totalMinor → total_minor", () => {
    expect(fxReceipts.totalMinor.name).toBe("total_minor");
    expect(fxReceiptItems.receiptId.name).toBe("receipt_id");
  });

  it("нет уникальности по одному id: ни unique, ни второго ключа", () => {
    const config = getTableConfig(fxReceipts);
    expect(config.uniqueConstraints).toEqual([]);
    expect(config.columns.filter((c) => c.primary || c.isUnique)).toEqual([]);
  });

  it("попадает в реестр как пользовательская — её узнаёт аудитор", () => {
    expect(registeredTables().get("fx_receipts")).toBe("user");
    expect([...ownedTableNames()].toSorted()).toEqual([
      "fx_receipt_items",
      "fx_receipts",
      "fx_transactions",
    ]);
  });
});

describe("ownedFk — ссылка только на строку своего домохозяйства", () => {
  it("составной FK (household_id, receipt_id) → fx_receipts (household_id, id) и индекс под него", () => {
    const config = getTableConfig(fxReceiptItems);
    const [fk] = config.foreignKeys;
    const ref = fk?.reference();
    expect(ref?.columns.map((c) => c.name)).toEqual(["household_id", "receipt_id"]);
    expect(ref?.foreignColumns.map((c) => c.name)).toEqual(["household_id", "id"]);
    expect(fk?.getName()).toBe("fx_receipt_items_receipt_id_fk");
    expect(config.indexes.map((i) => i.config.name)).toEqual([
      "fx_receipt_items_receipt_id_fk_idx",
    ]);
  });

  it("onDelete передаётся в ключ: cascade у позиций, set null у операции", () => {
    expect(getTableConfig(fxReceiptItems).foreignKeys[0]?.onDelete).toBe("cascade");
    expect(getTableConfig(fxTransactions).foreignKeys[0]?.onDelete).toBe("set null");
  });
});

describe("systemTable и publicTable", () => {
  it("системная и общая таблицы — в реестре со своим видом, аудитор их пользовательскими не считает", () => {
    expect(registeredTables().get(getTableName(fxSettings))).toBe("system");
    expect(registeredTables().get("fx_rates")).toBe("public");
    expect(ownedTableNames().has("fx_settings")).toBe(false);
    expect(getTableConfig(fxRates).name).toBe("fx_rates");
  });

  it("общая таблица с household_id не создаётся: «смешанных» таблиц нет", () => {
    expect(() => publicTable("fx_mixed", { code: text(), householdId: uuid() })).toThrow(
      /fx_mixed не может иметь household_id/,
    );
  });

  it("второе объявление таблицы с тем же именем — ошибка при загрузке схемы", () => {
    systemTable("fx_twice", { key: text() });
    expect(() => userOwnedTable("fx_twice", { note: text() })).toThrow(/fx_twice объявлена дважды/);
  });
});
