// make new-feature id=<id>: заготовка экрана сайта (ADR-0014, ARCHITECTURE §10.1): apps/web/src/features/<id>/
// с паспортом по шаблону docs/templates/feature-passport.md и index.ts — публичным входом фичи. Экран должен быть в
// таблице «Экраны сайта» docs/CAPABILITIES.md (макет и маршрут берутся оттуда), папки ещё не должно быть:
// готовый паспорт генератор не перезаписывает. Страницу, маршрут и словарь делает задача экрана.
//   node tooling/gen/new-feature.ts <id>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GenResult } from "./new-module.ts";

export const FEATURES_DIR = "apps/web/src/features";
export const CAPABILITIES = "docs/CAPABILITIES.md";
export const FEATURE_TEMPLATE = "docs/templates/feature-passport.md";

export interface ScreenRow {
  readonly id: string;
  /** Имена экранов макета: «Main», «MobileHome». */
  readonly screens: readonly string[];
  readonly route: string;
}

/** Строки таблицы «Экраны сайта»: `admin/<раздел>` — одна фича admin. */
export function parseScreens(capabilities: string): ScreenRow[] {
  const section = capabilities.split(/^## Экраны сайта.*$/m)[1]?.split(/^## /m)[0] ?? "";
  const rows: ScreenRow[] = [];
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const id = /^`([a-z][a-z0-9-]*)(?:\/[^`]*)?`$/.exec(cells[1] ?? "")?.[1];
    if (id === undefined) continue;
    const screens = [...(cells[2] ?? "").matchAll(/`([A-Za-z]+)`/g)].map((m) => m[1] ?? "");
    rows.push({ id, screens, route: cells[3] ?? "" });
  }
  return rows;
}

/** Паспорт из шаблона: без служебного комментария, с id, маршрутом и файлами макета. */
export function renderFeaturePassport(template: string, row: ScreenRow): string {
  const [main = "", ...extra] = row.screens;
  const shots = row.screens.map((s) => `\`design/screenshots/desktop/${s}.png\``).join(", ");
  return `${template
    .replace(/^<!--[\s\S]*?-->\n/, "")
    .replaceAll("<id>", row.id)
    .replace("`<путь, например /operations>`", row.route)
    .replace("`design/screens/<Экран>.dc.html`", `\`design/screens/${main}.dc.html\``)
    .replace("§ «<Экран>»", `§ «${main}»${extra.length > 0 ? ` (и ${extra.join(", ")})` : ""}`)
    .replace(
      "`design/screenshots/desktop/<Экран>.png`, `design/screenshots/mobile-width/<Экран>.png`",
      `${shots}, \`design/screenshots/mobile-width/${main}.png\``,
    )
    .trimEnd()}\n`;
}

export function renderFeatureIndex(id: string): string {
  return [
    `// Публичный вход экрана ${id} (паспорт — CLAUDE.md рядом): маршрут routes/ импортирует только этот файл`,
    "// (web-routes-thin) — отсюда экспортируется страница экрана.",
    "export {};",
    "",
  ].join("\n");
}

export function runNewFeature(options: { readonly root: string; readonly id: string }): GenResult {
  const { root, id } = options;
  const rows = parseScreens(readFileSync(join(root, CAPABILITIES), "utf8"));
  const row = rows.find((candidate) => candidate.id === id);
  if (row === undefined) {
    return {
      code: 1,
      files: [],
      messages: [
        `Экрана «${id}» нет в таблице «Экраны сайта» ${CAPABILITIES} (есть: ${rows.map((r) => r.id).join(", ")}).`,
        "Сначала добавьте строку экрана (макет, маршрут, модули) с обоснованием в итоге задачи.",
      ],
    };
  }
  const dir = join(FEATURES_DIR, id);
  if (existsSync(join(root, dir))) {
    return {
      code: 1,
      files: [],
      messages: [`${dir} уже есть: генератор не перезаписывает экран.`],
    };
  }
  mkdirSync(join(root, dir), { recursive: true });
  const template = readFileSync(join(root, FEATURE_TEMPLATE), "utf8");
  const files: [string, string][] = [
    [join(dir, "CLAUDE.md"), renderFeaturePassport(template, row)],
    [join(dir, "index.ts"), renderFeatureIndex(id)],
  ];
  for (const [path, text] of files) writeFileSync(join(root, path), text);
  return {
    code: 0,
    files: files.map(([path]) => path),
    messages: [
      `Создан экран ${id}: паспорт (макет и маршрут — из ${CAPABILITIES}) и index.ts.`,
      "Дальше: строки паспорта в <угловых скобках>, страница, маршрут в routes/, словарь в packages/i18n.",
    ],
  };
}

function main(): number {
  const id = process.argv[2] ?? "";
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const result = runNewFeature({ root, id });
  for (const message of result.messages) {
    if (result.code === 0) console.log(message);
    else console.error(message);
  }
  return result.code;
}

if (import.meta.main) process.exitCode = main();
