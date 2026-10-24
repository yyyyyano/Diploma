// make capabilities: таблицы ярусов в docs/CAPABILITIES.md из modules.ts (ADR-0003). Генерируется только
// содержимое между метками `<!-- capabilities:tier-N -->` и `<!-- /capabilities:tier-N -->`; остальной текст
// файла (как читать, кто слушает события, порядок фаз, экраны) правится руками.
//   node tooling/architecture/capabilities.ts — переписать таблицы; без изменений файл не трогается.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MODULES, type ModuleDef, type Tier } from "./modules.ts";

const HEADER = [
  "| id | SPEC | Ответственность | Зависит от | Таблицы | Публикует |",
  "|---|---|---|---|---|---|",
];

function list(items: readonly string[], code: boolean): string {
  if (items.length === 0) return "—";
  return items.map((item) => (code ? `\`${item}\`` : item)).join(", ");
}

function row(m: ModuleDef): string {
  const cells = [
    `\`${m.id}\``,
    m.spec,
    m.responsibility,
    list(m.dependsOn, false),
    list(m.tables, false),
    list(m.publishes, true),
  ];
  // Черта или перевод строки внутри ячейки молча развалили бы таблицу Markdown.
  if (cells.some((cell) => /[|\n]/.test(cell))) {
    throw new Error(`modules.ts, модуль ${m.id}: в ячейке таблицы нельзя «|» и перевод строки`);
  }
  return `| ${cells.join(" | ")} |`;
}

/** Таблица одного яруса: заголовок и строки модулей в порядке modules.ts. */
export function renderTierTable(modules: readonly ModuleDef[], tier: Tier): string {
  return [...HEADER, ...modules.filter((m) => m.tier === tier).map(row)].join("\n");
}

/** Текст файла с перегенерированными таблицами всех ярусов, в которых есть модули. */
export function applyTables(markdown: string, modules: readonly ModuleDef[]): string {
  const tiers = [...new Set(modules.map((m) => m.tier))];
  let result = markdown;
  for (const tier of tiers) {
    const open = `<!-- capabilities:tier-${tier} -->`;
    const close = `<!-- /capabilities:tier-${tier} -->`;
    const start = result.indexOf(open);
    const end = result.indexOf(close);
    if (start === -1 || end === -1 || end < start) {
      throw new Error(
        `docs/CAPABILITIES.md: нет меток ${open} … ${close} — куда писать таблицу яруса ${tier}`,
      );
    }
    const before = result.slice(0, start + open.length);
    const after = result.slice(end);
    result = `${before}\n${renderTierTable(modules, tier)}\n${after}`;
  }
  return result;
}

function main(): number {
  const path = fileURLToPath(new URL("../../docs/CAPABILITIES.md", import.meta.url));
  const current = readFileSync(path, "utf8");
  const next = applyTables(current, MODULES);
  if (next === current) {
    console.log("docs/CAPABILITIES.md: таблицы совпадают с modules.ts.");
    return 0;
  }
  writeFileSync(path, next);
  console.log("docs/CAPABILITIES.md: таблицы ярусов перегенерированы из modules.ts.");
  return 0;
}

if (import.meta.main) process.exitCode = main();
