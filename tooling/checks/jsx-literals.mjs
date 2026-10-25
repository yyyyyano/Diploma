#!/usr/bin/env node
// make static-checks → jsx-literals: текст интерфейса — только через t() (NFR-19, .claude/rules/i18n.md).
//   node tooling/checks/jsx-literals.mjs
// Код выхода: 0 — чисто; 1 — нарушение; 2 — не смог проверить (корень есть, а файлов 0; Oxlint упал или
// проверил не все файлы).
// Как: правило Oxlint react/jsx-no-literals разбирает JSX настоящим парсером (свой конфиг во временной папке,
// чтобы не тянуть type-aware линт всего проекта): текст между тегами, строка или шаблон в {…} среди детей,
// литерал в кавычках у текстовых атрибутов. Строку в {…} у атрибута (aria-label={"…"}) Oxlint пропускает —
// её ищет регулярное выражение. Литерал — текст хотя бы с одной буквой: знаки, числа, «—», &nbsp; разрешены.
// Не ловится (ревью): строка в тернарном выражении ({ok ? "Да" : t("no")}) и в переменной; тексты бота, писем
// и уведомлений — это не JSX.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkResult, listFiles, report, splitSource, withoutComments } from "./source-text.mjs";

export const ROOTS = ["apps/web/src"];

/** Атрибуты, значение которых видит человек (экранный диктор — тоже): подписи Mantine и доступности. */
export const TEXT_ATTRIBUTES = [
  "aria-label",
  "title",
  "placeholder",
  "alt",
  "label",
  "description",
  "error",
];

/** Тесты, настройка тестов сайта и витрина компонентов /dev/gallery — страница features/dev-gallery (T-008). */
const SKIP = /\.(test|spec)\.tsx$|^apps\/web\/src\/test\/|^apps\/web\/src\/features\/dev-gallery\//;

const RULE_CODE = "react(jsx-no-literals)";
const OXLINT_CONFIG = {
  plugins: ["react"],
  categories: { correctness: "off" },
  rules: {
    "react/jsx-no-literals": [
      "error",
      { noStrings: true, ignoreProps: true, restrictedAttributes: TEXT_ATTRIBUTES },
    ],
  },
};
const WRAPPED_ATTRIBUTE = new RegExp(
  String.raw`(?<![\w-])(?:${TEXT_ATTRIBUTES.join("|")})=\{\s*(["'\x60])([^"'\x60]*)\1\s*\}`,
  "g",
);
const HTML_ENTITY = /&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g;
const LETTER = /\p{L}/u;

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const oxlintBin = join(repoRoot, "node_modules/.bin/oxlint");

/**
 * @param {{ baseDir: string, oxlint?: string }} options oxlint — путь к исполняемому файлу (подмена в тестах)
 * @returns {import("./source-text.mjs").CheckResult}
 */
export function runJsxLiterals({ baseDir, oxlint = oxlintBin }) {
  const { roots, files } = listFiles(baseDir, ROOTS, {
    extensions: ["tsx"],
    skip: (path) => SKIP.test(path),
  });
  if (files.length === 0) return checkResult({ roots, files, findings: [] });

  const lint = runOxlint(oxlint, baseDir, files);
  if ("error" in lint) {
    return { code: 2, files: files.length, findings: [], messages: [lint.error] };
  }
  // В конфиге одно правило: чужой код или диагностика без места значат, что Oxlint изменился, — иначе проверка
  // молча пустеет.
  const foreign = lint.diagnostics.find((d) => d.code !== RULE_CODE || !d.labels?.[0]?.span);
  if (foreign) {
    const message =
      `Oxlint вернул диагностику «${foreign.code}» без места или вместо ${RULE_CODE}: ` +
      "проверьте имя правила и формат --format json.";
    return { code: 2, files: files.length, findings: [], messages: [message] };
  }
  const findings = [];
  for (const diagnostic of lint.diagnostics) {
    const span = diagnostic.labels[0].span;
    const bytes = readFileSync(join(baseDir, diagnostic.filename));
    const text = bytes.subarray(span.offset, span.offset + span.length).toString("utf8");
    // У атрибута в отметке и имя (alt=""), буквы ищутся только в значении.
    const isAttribute = diagnostic.message.includes("attribute");
    const valueAt = isAttribute ? text.indexOf("=") + 1 : 0;
    const visible = text.replaceAll(HTML_ENTITY, (entity) => " ".repeat(entity.length));
    const letterAt = visible.slice(valueAt).search(LETTER);
    if (letterAt < 0) continue;
    const before =
      bytes.subarray(0, span.offset).toString("utf8") + text.slice(0, valueAt + letterAt);
    const snippet = isAttribute ? text : visible.trim().replace(/^["'`]|["'`]$/g, "");
    findings.push(finding(diagnostic.filename, before.split("\n").length, snippet));
  }
  for (const file of files) {
    const text = withoutComments(splitSource(readFileSync(join(baseDir, file), "utf8")));
    text.split("\n").forEach((lineText, index) => {
      for (const m of lineText.matchAll(WRAPPED_ATTRIBUTE)) {
        if (LETTER.test(m[2] ?? "")) findings.push(finding(file, index + 1, m[0]));
      }
    });
  }
  return checkResult({ roots, files, findings });
}

function finding(file, line, snippet) {
  const short = snippet.replaceAll(/\s+/g, " ").trim();
  return {
    file,
    line,
    rule: "jsx-literal",
    message:
      `текст «${short.length > 60 ? `${short.slice(0, 57)}…` : short}» литералом в JSX (NFR-19): ` +
      'выведите его через t("ns:экран.ключ") из словаря @kosht/i18n.',
  };
}

/**
 * Oxlint только с правилом jsx-no-literals по списку файлов (пути относительно baseDir).
 * Проверено не столько файлов, сколько передано, — ошибка: иначе проверка молча пустеет.
 */
function runOxlint(oxlint, baseDir, files) {
  const configDir = mkdtempSync(join(tmpdir(), "jsx-literals-"));
  try {
    const config = join(configDir, ".oxlintrc.json");
    writeFileSync(config, JSON.stringify(OXLINT_CONFIG));
    const run = spawnSync(
      oxlint,
      ["-c", config, "--disable-nested-config", "--format", "json", ...files],
      { cwd: baseDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (run.error || (run.status !== 0 && run.status !== 1)) {
      return {
        error: `Oxlint не отработал (код ${run.status}): ${run.error?.message ?? run.stderr.trim()}`,
      };
    }
    let output;
    try {
      output = JSON.parse(run.stdout);
    } catch {
      return { error: `Oxlint вернул не JSON: ${run.stdout.slice(0, 200)}` };
    }
    if (output.number_of_files !== files.length) {
      return {
        error:
          `Oxlint проверил файлов: ${output.number_of_files}, а передано ${files.length} — ` +
          "проверка литералов неполна (игнор-файлы или версия Oxlint).",
      };
    }
    return { diagnostics: output.diagnostics ?? [] };
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.exitCode = report("jsx-literals", runJsxLiterals({ baseDir: repoRoot }));
}
