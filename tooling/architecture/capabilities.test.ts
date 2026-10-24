// make capabilities (docs/CAPABILITIES.md): таблицы ярусов генерируются из modules.ts, остальной текст файла
// не трогается; закоммиченный файл всегда совпадает с картой.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyTables, renderTierTable } from "./capabilities.ts";
import type { ModuleDef } from "./modules.ts";

const capabilitiesPath = fileURLToPath(new URL("../../docs/CAPABILITIES.md", import.meta.url));

const receipts: ModuleDef = {
  id: "receipts",
  tier: 2,
  spec: "RCPT-01…15",
  responsibility: "чеки: QR, распознавание",
  dependsOn: ["files", "transactions"],
  tables: ["user"],
  publishes: ["receipts.recognized", "receipts.needs-review"],
};
const fin: ModuleDef = {
  id: "fin",
  tier: 3,
  spec: "FIN-01",
  responsibility: "свободный остаток",
  dependsOn: [],
  tables: [],
  publishes: [],
};

describe("renderTierTable", () => {
  it("строка модуля: id в кавычках-кодах, списки через запятую, события в кавычках-кодах", () => {
    expect(renderTierTable([receipts, fin], 2).split("\n")).toEqual([
      "| id | SPEC | Ответственность | Зависит от | Таблицы | Публикует |",
      "|---|---|---|---|---|---|",
      "| `receipts` | RCPT-01…15 | чеки: QR, распознавание | files, transactions | user | `receipts.recognized`, `receipts.needs-review` |",
    ]);
  });

  it("пустые зависимости, таблицы и события — прочерк", () => {
    expect(renderTierTable([fin], 3).split("\n")[2]).toBe(
      "| `fin` | FIN-01 | свободный остаток | — | — | — |",
    );
  });

  it("вертикальная черта в ячейке сломала бы таблицу — ошибка с именем модуля", () => {
    expect(() => renderTierTable([{ ...fin, responsibility: "а | б" }], 3)).toThrow(/fin/);
  });
});

describe("applyTables", () => {
  const doc = [
    "# Заголовок",
    "текст до",
    "<!-- capabilities:tier-3 -->",
    "старая таблица",
    "<!-- /capabilities:tier-3 -->",
    "текст после",
  ].join("\n");

  it("заменяет только содержимое между метками яруса, остальной текст сохраняется", () => {
    expect(applyTables(doc, [fin]).split("\n")).toEqual([
      "# Заголовок",
      "текст до",
      "<!-- capabilities:tier-3 -->",
      "| id | SPEC | Ответственность | Зависит от | Таблицы | Публикует |",
      "|---|---|---|---|---|---|",
      "| `fin` | FIN-01 | свободный остаток | — | — | — |",
      "<!-- /capabilities:tier-3 -->",
      "текст после",
    ]);
  });

  it("повторный прогон ничего не меняет", () => {
    const once = applyTables(doc, [fin]);
    expect(applyTables(once, [fin])).toBe(once);
  });

  it("ярус модуля без меток в файле — понятная ошибка, а не молчаливый пропуск", () => {
    expect(() => applyTables(doc, [receipts, fin])).toThrow(/capabilities:tier-2/);
  });
});

describe("docs/CAPABILITIES.md", () => {
  it("таблицы ярусов совпадают с modules.ts — после правки карты выполните make capabilities", async () => {
    const { MODULES } = await import("./modules.ts");
    const current = readFileSync(capabilitiesPath, "utf8");
    expect(applyTables(current, MODULES)).toBe(current);
  });

  it("шапка предупреждает, что таблицы генерируются и вручную не правятся", () => {
    expect(readFileSync(capabilitiesPath, "utf8")).toContain("таблицы генерируются, не править");
  });
});
