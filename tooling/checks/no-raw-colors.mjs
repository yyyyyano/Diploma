#!/usr/bin/env node
// make static-checks → no-raw-colors: цвета, отступы и радиусы сайта — только токенами темы (DES-01, ADR-0014,
// CONSTRAINTS «Архитектурные запреты»). «Сырые» значения допустимы лишь в apps/web/src/ui/theme.
//   node tooling/checks/no-raw-colors.mjs
// Код выхода: 0 — чисто; 1 — нарушение; 2 — apps/web/src есть, а проверяемых файлов 0.
// Что ловится: в .ts/.tsx — #hex, rgb(…), hsl(…) и т. п. в строках и шаблонах; ненулевое число у padding*,
// margin*, gap, border*Radius в объектах стилей и у отступов Mantine (p, m, gap, radius…); в .css — цвета в
// значениях свойств и ненулевые числа у отступов и радиусов. Имена цветов («red») и значение не первым словом
// («0 13px») не ловятся — это ревью.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkResult, listFiles, report, splitSource, withoutComments } from "./source-text.mjs";

export const ROOTS = ["apps/web/src"];

/** Тема: копия design/tokens.css и таблицы цветов категорий и графиков (frontend-ui.md). */
export const THEME_DIR = "apps/web/src/ui/theme/";

const TEST_CODE = /\.(test|spec)\.tsx?$|^apps\/web\/src\/test\//;

const COLOR =
  /(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(/g;
/** Ненулевое число: `13`, `-8`, `0.5`, но не `0`. */
const NUMBER = String.raw`(-?(?=[\d.]*[1-9])[\d.]+)`;
const STYLE_KEY = new RegExp(
  String.raw`\b(padding\w*|margin\w*|gap|rowGap|columnGap|border\w*Radius)\s*:\s*["'\x60]?\s*${NUMBER}`,
  "g",
);
const MANTINE_PROP = new RegExp(
  String.raw`(?<![\w-])(p[xytrblse]?|m[xytrblse]?|gap|rowGap|columnGap|radius)=\{?\s*["'\x60]?\s*${NUMBER}`,
  "g",
);
const CSS_VALUE = /:[^;{}]*(?=;|}|$)/g;
const CSS_SPACING = new RegExp(
  String.raw`(?<![\w-])((?:padding|margin|inset)(?:-[a-z]+)*|gap|row-gap|column-gap|border(?:-[a-z]+)*-radius)\s*:\s*${NUMBER}`,
  "g",
);

const COLOR_MESSAGE = (token) =>
  `сырой цвет «${token}» вне ui/theme (DES-01): возьмите токен из ui/theme/tokens.css (var(--brand) и т. п.) ` +
  "или таблицу ui/theme/category-colors.ts, chart-colors.ts.";
const SPACING_MESSAGE = (token) =>
  `магическое число «${token}» вне ui/theme: отступы — шкалой темы (p="md", gap="sm", ` +
  'var(--mantine-spacing-md)), радиусы — var(--r), var(--r-sm) или radius="md".';

/**
 * @param {{ baseDir: string }} options
 * @returns {import("./source-text.mjs").CheckResult}
 */
export function runNoRawColors({ baseDir }) {
  const { roots, files } = listFiles(baseDir, ROOTS, {
    extensions: ["ts", "tsx", "css"],
    skip: (path) => path.startsWith(THEME_DIR) || TEST_CODE.test(path),
  });
  const findings = [];
  for (const file of files) {
    const parts = splitSource(readFileSync(join(baseDir, file), "utf8"));
    const lines = file.endsWith(".css")
      ? cssFindings(withoutComments(parts))
      : scriptFindings(parts);
    for (const { line, rule, token } of lines.toSorted((a, b) => a.line - b.line)) {
      const message = rule === "raw-color" ? COLOR_MESSAGE(token) : SPACING_MESSAGE(token);
      findings.push({ file, line, rule, message });
    }
  }
  return checkResult({ roots, files, findings });
}

function scriptFindings(parts) {
  const found = [];
  const text = withoutComments(parts);
  const stringLines = parts.strings.split("\n");
  text.split("\n").forEach((lineText, index) => {
    const line = index + 1;
    for (const m of (stringLines[index] ?? "").matchAll(COLOR)) {
      found.push({ line, rule: "raw-color", token: m[0] });
    }
    for (const m of lineText.matchAll(STYLE_KEY)) {
      found.push({ line, rule: "magic-spacing", token: `${m[1]}: ${m[2]}` });
    }
    for (const m of lineText.matchAll(MANTINE_PROP)) {
      found.push({ line, rule: "magic-spacing", token: `${m[1]}=${m[2]}` });
    }
  });
  return found;
}

function cssFindings(text) {
  const found = [];
  text.split("\n").forEach((lineText, index) => {
    const line = index + 1;
    for (const value of lineText.matchAll(CSS_VALUE)) {
      for (const m of value[0].matchAll(COLOR))
        found.push({ line, rule: "raw-color", token: m[0] });
    }
    for (const m of lineText.matchAll(CSS_SPACING)) {
      found.push({ line, rule: "magic-spacing", token: `${m[1]}: ${m[2]}` });
    }
  });
  return found;
}

if (import.meta.main) {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  process.exitCode = report("no-raw-colors", runNoRawColors({ baseDir: repoRoot }));
}
