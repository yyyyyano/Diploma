#!/usr/bin/env node
// make static-checks → calc-no-clock: packages/calc — чистые функции (P1, ARCHITECTURE §2, ADR-0017): ни часов,
// ни случайности, ни зависящего от среды Intl. Сегодня приходит аргументом из Clock на сервере.
//   node tooling/checks/calc-no-clock.mjs
// Код выхода: 0 — чисто; 1 — нарушение; 2 — пакет есть, а проверяемых файлов 0.
// Проверяется весь packages/calc, кроме тестов; kernel не проверяется: LocalDate (Минск) законно использует Intl.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkResult,
  findAll,
  listFiles,
  report,
  splitSource,
  withoutComments,
} from "./source-text.mjs";

export const ROOTS = ["packages/calc"];

const TEST_CODE = /\.(test|spec)\.tsx?$/;

/** Часы, случайность и среда. `new Date(x)` с аргументом, `Date.parse`, `Date.UTC` — чистые и разрешены. */
const CLOCK =
  /\bnew\s+Date\b(?:\s*\(\s*\)|(?!\s*\())|\bDate\s*\.\s*now\b|\bMath\s*\.\s*random\b|\bIntl\b|\bTemporal\s*\.\s*Now\b|\bperformance\s*\.\s*now\b|\bcrypto\s*\.\s*(?:randomUUID|getRandomValues|randomBytes|randomInt)\b/;

/**
 * Модули случайности и часов: после `import { randomUUID } from "node:crypto"` вызов уже без `crypto.`, поэтому
 * запрещён сам импорт (статический, `export … from` и `import(…)`). Имя модуля — в строке, ищется вне комментариев.
 */
const CLOCK_MODULE =
  /\bfrom\s*["'](?:node:)?(?:crypto|perf_hooks)["']|\bimport\s*\(\s*["'](?:node:)?(?:crypto|perf_hooks)["']/;

/**
 * @param {{ baseDir: string }} options
 * @returns {import("./source-text.mjs").CheckResult}
 */
export function runCalcNoClock({ baseDir }) {
  const { roots, files } = listFiles(baseDir, ROOTS, {
    extensions: ["ts", "tsx", "mts", "cts"],
    skip: (path) => TEST_CODE.test(path),
  });
  const findings = [];
  for (const file of files) {
    const parts = splitSource(readFileSync(join(baseDir, file), "utf8"));
    const matches = [
      ...findAll(parts.code, CLOCK),
      ...findAll(withoutComments(parts), CLOCK_MODULE),
    ];
    for (const { line, match } of matches.toSorted((a, b) => a.line - b.line)) {
      findings.push({
        file,
        line,
        rule: "calc-no-clock",
        message:
          `найдено «${match.replaceAll(/\s+/g, " ").trim()}»: calc не читает часы, случайность и среду ` +
          "(P1, ARCHITECTURE §2) — передайте дату или значение аргументом (сегодня — из Clock на сервере).",
      });
    }
  }
  return checkResult({ roots, files, findings });
}

if (import.meta.main) {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  process.exitCode = report("calc-no-clock", runCalcNoClock({ baseDir: repoRoot }));
}
