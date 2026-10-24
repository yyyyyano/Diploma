#!/usr/bin/env node
// make static-checks → floor: «Пол» CONSTRAINTS.md там, где его не ловит или ловит без проверки причины Oxlint
// (.oxlintrc.json: .skip/.only в Vitest, @ts-ignore, пустой catch). Ловит:
//   - отключённые и выборочные тесты: it/test/describe… .fails, .fail, .todo, .fixme, .skip, .only, .skipIf, .runIf;
//     xit, xtest, xdescribe — в коде;
//   - подавления проверок (oxlint/eslint-disable, biome-ignore, istanbul/c8/v8 ignore, @ts-ignore, @ts-nocheck,
//     @ts-expect-error вне тестов) — если ни на той же, ни на предыдущей строке нет ID задачи T-NNN;
//   - TODO, FIXME, XXX в комментариях без ID в виде TODO(T-034);
//   - строку «Not implemented».
// Закомментированный код и catch, глотающий ошибку, текстом не поймать — это ревью.
//   node tooling/checks/floor.mjs
// Код выхода: 0 — чисто; 1 — нарушение; 2 — проверено меньше MIN_FILES файлов (проверка, скорее всего, пуста).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOTS } from "../architecture/rules.ts";
import { checkResult, findAll, listFiles, report, splitSource } from "./source-text.mjs";

/**
 * Сколько файлов должно попасть в обход — по реально существующим файлам корней apps, packages, e2e, tooling
 * (без фикстур и самого floor): 66 на конец T-003; задачи, добавляющие код, поднимают его. Опускать порог, чтобы
 * прошло, нельзя (CONSTRAINTS «Пол»).
 */
export const MIN_FILES = 66;

/** Сам floor и его тест содержат то, что ищут, — как образцы; их не проверяем. */
const SELF = new Set(["tooling/checks/floor.mjs", "tooling/checks/floor.test.ts"]);
const TEST_CODE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const TASK_ID = /\bT-\d{3}\b/;

const DISABLED_TEST =
  /\b(?:it|test|describe|suite|bench)(?:\s*\.\s*\w+)*?\s*\.\s*(?:fails?|todo|fixme|skip|only|skipIf|runIf)\b|\b(?:xit|xtest|xdescribe)\s*\(/;
const SUPPRESSION =
  /\b(?:oxlint|eslint)-disable(?:-next-line|-line)?\b|\bbiome-ignore\b|\b(?:istanbul|c8|v8)\s+ignore\b|@ts-(?:ignore|nocheck|expect-error)\b/;
const TODO = /\b(?:TODO|FIXME|XXX)\b(?!\(T-\d{3}\))/;
const NOT_IMPLEMENTED = /not\s+implemented/i;

/**
 * @param {{ baseDir: string, minFiles: number }} options
 * @returns {import("./source-text.mjs").CheckResult}
 */
export function runFloor({ baseDir, minFiles }) {
  const { roots, files } = listFiles(baseDir, ROOTS, {
    extensions: ["ts", "tsx", "mts", "cts", "js", "mjs", "cjs"],
    skip: (path) => SELF.has(path),
  });
  if (files.length < minFiles) {
    return {
      code: 2,
      files: files.length,
      findings: [],
      messages: [
        `Проверено файлов: ${files.length} — меньше порога ${minFiles} (MIN_FILES в tooling/checks/floor.mjs).\n` +
          "  Проверка «Пола», скорее всего, пуста: корни обхода исключены или файлы удалены.",
      ],
    };
  }
  const findings = [];
  for (const file of files) {
    const text = readFileSync(join(baseDir, file), "utf8");
    const { code, comments, strings } = splitSource(text);
    const rawLines = text.split("\n");
    const add = (line, rule, message) => findings.push({ file, line, rule, message });

    for (const { line, match } of findAll(code, DISABLED_TEST)) {
      add(
        line,
        "disabled-test",
        `отключённый или выборочный тест «${match.replaceAll(/\s+/g, "")}» (CONSTRAINTS «Пол»): тест ` +
          "выполняется всегда — почините код или тест, а не выключайте его.",
      );
    }
    for (const { line, match } of findAll(comments, SUPPRESSION)) {
      if (match === "@ts-expect-error" && TEST_CODE.test(file)) continue;
      const nearby = `${rawLines[line - 2] ?? ""}\n${rawLines[line - 1] ?? ""}`;
      if (TASK_ID.test(nearby)) continue;
      add(
        line,
        "suppression",
        `подавление проверки «${match}» без причины (CONSTRAINTS «Пол»): на той же или предыдущей строке ` +
          "напишите, почему, и ID задачи (T-123) — или уберите подавление и исправьте код.",
      );
    }
    for (const { line, match } of findAll(comments, TODO)) {
      add(
        line,
        "todo-without-id",
        `«${match}» без ID задачи (CONSTRAINTS «Пол»): напишите ${match}(T-034): … ` +
          "с номером задачи или доделайте сейчас.",
      );
    }
    for (const { line, match } of findAll(strings, NOT_IMPLEMENTED)) {
      add(
        line,
        "not-implemented",
        `заглушка «${match}» (CONSTRAINTS «Пол»): реализуйте поведение или не добавляйте этот код.`,
      );
    }
  }
  return checkResult({ roots, files, findings });
}

if (import.meta.main) {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  process.exitCode = report("floor", runFloor({ baseDir: repoRoot, minFiles: MIN_FILES }));
}
