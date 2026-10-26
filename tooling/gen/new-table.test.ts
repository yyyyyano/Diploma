// make new-table (ARCHITECTURE §6.1, .claude/rules/database.md): вид таблицы — только из tables модуля в
// modules.ts; пользовательская таблица сразу попадает в defineUserData и подключается в module.ts.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleDef } from "../architecture/modules.ts";
import { MODULES_DIR, runNewModule } from "./new-module.ts";
import { addTable, runNewTable } from "./new-table.ts";

function def(id: string, tables: ModuleDef["tables"]): ModuleDef {
  return { id, tier: 2, spec: "—", responsibility: "—", dependsOn: [], tables, publishes: [] };
}

const MAP = [def("receipts", ["user"]), def("legal-base", ["public", "system"])];

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kosht-new-table-"));
  for (const m of MAP) runNewModule({ root, id: m.id, modules: MAP });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function read(id: string, path: string): string {
  return readFileSync(join(root, MODULES_DIR, id, path), "utf8");
}

describe("вид таблицы — из modules.ts", () => {
  it("системная таблица у модуля только с user — отказ с видами модуля", () => {
    const result = runNewTable({
      root,
      module: "receipts",
      name: "receipt_logs",
      kind: "system",
      modules: MAP,
    });
    expect(result).toMatchObject({ code: 1, files: [] });
    expect(result.messages.join("\n")).toContain("есть: user");
  });

  it("неизвестный вид — отказ", () => {
    expect(
      runNewTable({ root, module: "receipts", name: "x_items", kind: "shared", modules: MAP }).code,
    ).toBe(1);
  });

  it("модуль без папки — отказ с подсказкой make new-module", () => {
    const result = runNewTable({
      root,
      module: "budgets",
      name: "goals",
      modules: [...MAP, def("budgets", ["user"])],
    });
    expect(result.messages.join("\n")).toContain("make new-module id=budgets");
  });

  it("имя не snake_case — отказ", () => {
    expect(runNewTable({ root, module: "receipts", name: "ReceiptItems", modules: MAP }).code).toBe(
      1,
    );
  });
});

describe("PRIV-06: пользовательская таблица сразу у владельца данных", () => {
  it("схема, defineUserData и userData в module.ts; подсказки фикстуры изоляции и миграции", () => {
    const result = runNewTable({ root, module: "receipts", name: "receipts", modules: MAP });
    expect(result.code).toBe(0);
    expect(read("receipts", "infrastructure/db/schema.ts")).toContain(
      'export const receipts = userOwnedTable("receipts", {',
    );
    expect(read("receipts", "user-data.ts")).toContain(
      "export const receiptsUserData = defineUserData({ tables: [receipts] });",
    );
    const module = read("receipts", "module.ts");
    expect(module).toContain('defineModule({ id: "receipts", userData: receiptsUserData })');
    expect(module).toContain('import { receiptsUserData } from "./user-data.ts";');
    expect(result.messages.join("\n")).toMatch(
      /фикстуру[\s\S]*make db-generate name=receipts-receipts/,
    );
  });

  it("импорт владельца данных встаёт после многострочного импорта module.ts, а не внутрь него", () => {
    // Так module.ts выглядит после форматера (oxfmt переносит длинный импорт платформы по строкам).
    writeFileSync(
      join(root, MODULES_DIR, "receipts", "module.ts"),
      [
        "// Модуль receipts.",
        "import {",
        "  defineModule,",
        "  type ModuleDeps,",
        "  type NoFacades,",
        "  type Platform,",
        '} from "../../platform/module/define-module.ts";',
        "",
        "export function createReceiptsModule(_deps: ModuleDeps<NoFacades, Platform>) {",
        '  return defineModule({ id: "receipts" });',
        "}",
        "",
      ].join("\n"),
    );
    expect(runNewTable({ root, module: "receipts", name: "receipts", modules: MAP }).code).toBe(0);
    const lines = read("receipts", "module.ts").split("\n");
    expect(lines.slice(1, 8)).toEqual([
      "import {",
      "  defineModule,",
      "  type ModuleDeps,",
      "  type NoFacades,",
      "  type Platform,",
      '} from "../../platform/module/define-module.ts";',
      'import { receiptsUserData } from "./user-data.ts";',
    ]);
    expect(lines).toContain(
      '  return defineModule({ id: "receipts", userData: receiptsUserData });',
    );
  });

  it("вторая таблица — первой в списке и в том же импорте схемы; повтор имени — отказ", () => {
    runNewTable({ root, module: "receipts", name: "receipts", modules: MAP });
    expect(
      runNewTable({ root, module: "receipts", name: "receipt_items", modules: MAP }).code,
    ).toBe(0);
    const userData = read("receipts", "user-data.ts");
    expect(userData).toContain(
      'import { receiptItems, receipts } from "./infrastructure/db/schema.ts";',
    );
    expect(userData).toContain("tables: [receiptItems, receipts]");
    expect(
      runNewTable({ root, module: "receipts", name: "receipt_items", modules: MAP }).code,
    ).toBe(1);
  });
});

describe("системные и общие таблицы", () => {
  it("импорт видов таблиц дополняется, defineUserData не трогается", () => {
    runNewTable({ root, module: "legal-base", name: "law_acts", kind: "public", modules: MAP });
    runNewTable({
      root,
      module: "legal-base",
      name: "law_fetch_logs",
      kind: "system",
      modules: MAP,
    });
    const schema = read("legal-base", "infrastructure/db/schema.ts");
    expect(schema).toContain(
      'import { publicTable, systemTable } from "../../../../platform/db/tables.ts";',
    );
    expect(schema).toContain('export const lawFetchLogs = systemTable("law_fetch_logs", {');
    expect(() => read("legal-base", "user-data.ts")).toThrow(/ENOENT/);
  });

  it("новый файл схемы начинается с комментария модуля и импорта платформы", () => {
    expect(addTable(undefined, "fx-rates", "fx_rates", "public").split("\n").slice(0, 2)).toEqual([
      "// Таблицы модуля fx-rates (ARCHITECTURE §6.1): вид — из modules.ts и паспорта; миграция — make db-generate.",
      'import { publicTable } from "../../../../platform/db/tables.ts";',
    ]);
  });
});
