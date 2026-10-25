// Общая основа своих проверок (T-056): разметка исходника и обход корней.
// Парсера TypeScript в зависимостях нет (TS 7 не даёт JS-API, typescript@6 лежит только под dependency-cruiser),
// поэтому проверки текстовые: исходник делится на три слоя одинаковой длины — код, комментарии, строки, —
// а дальше каждая проверка ищет регулярным выражением в нужном слое. Позиции и переводы строк сохраняются,
// так что номер строки совпадения — номер строки в файле.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES_DIR } from "../architecture/rules.ts";

/** Папки, которые не обходит ни одна проверка: зависимости, сборка, данные тестов. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-e2e",
  "build",
  "coverage",
  ".turbo",
  "__fixtures__",
  "__cassettes__",
]);

/** Ключевые слова, после которых `/` начинает регулярное выражение, а не деление. */
const REGEX_AFTER_WORD = new Set([
  "return",
  "typeof",
  "instanceof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
]);
// Без `<` и `}`: в .tsx это закрывающий тег (`</a>`) и текст после выражения (`{a}/{b}`), а не начало регэкспа.
const REGEX_AFTER_CHAR = new Set("(,=:[!&|?{;+-*%>~^");

/**
 * Делит исходник на код, комментарии и строки. В `code` комментарии, текст строк и тела регулярных выражений
 * заменены пробелами (кавычки, косые черты и выражения `${…}` шаблонов остаются); в `comments` — только текст
 * комментариев; в `strings` — только текст строк и шаблонов. Незакрытая строка обрывается на конце строки,
 * поэтому апостроф в тексте JSX портит разметку только одной строки.
 * @param {string} text
 * @returns {{ code: string, comments: string, strings: string }}
 */
export function splitSource(text) {
  const code = [];
  const comments = [];
  const strings = [];
  /** @param {string} ch @param {"code" | "comment" | "string" | "none"} kind */
  const put = (ch, kind) => {
    if (ch === "\n") {
      code.push(ch);
      comments.push(ch);
      strings.push(ch);
      return;
    }
    code.push(kind === "code" ? ch : " ");
    comments.push(kind === "comment" ? ch : " ");
    strings.push(kind === "string" ? ch : " ");
  };
  // Для каждого открытого `${` — глубина фигурных скобок кода внутри него.
  const templateDepth = [];
  let inTemplate = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];

    if (inTemplate) {
      if (ch === "\\" && i + 1 < n) {
        put(ch, "string");
        put(text[i + 1], "string");
        i += 2;
      } else if (ch === "`") {
        put(ch, "code");
        inTemplate = false;
        i += 1;
      } else if (ch === "$" && next === "{") {
        put("$", "code");
        put("{", "code");
        templateDepth.push(0);
        inTemplate = false;
        i += 2;
      } else {
        put(ch, "string");
        i += 1;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      put("/", "none");
      put("/", "none");
      i += 2;
      while (i < n && text[i] !== "\n") put(text[i++], "comment");
    } else if (ch === "/" && next === "*") {
      put("/", "none");
      put("*", "none");
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) put(text[i++], "comment");
      if (i < n) {
        put("*", "none");
        put("/", "none");
        i += 2;
      }
    } else if (ch === "/" && next !== ">" && regexAllowed(code)) {
      i = skipRegex(text, i, put);
    } else if (ch === '"' || ch === "'") {
      put(ch, "code");
      i += 1;
      while (i < n && text[i] !== "\n") {
        if (text[i] === "\\" && i + 1 < n) {
          put(text[i], "string");
          put(text[i + 1], "string");
          i += 2;
        } else if (text[i] === ch) {
          put(ch, "code");
          i += 1;
          break;
        } else {
          put(text[i++], "string");
        }
      }
    } else if (ch === "`") {
      put(ch, "code");
      inTemplate = true;
      i += 1;
    } else if (ch === "{" && templateDepth.length > 0) {
      templateDepth[templateDepth.length - 1] += 1;
      put(ch, "code");
      i += 1;
    } else if (ch === "}" && templateDepth.length > 0) {
      put(ch, "code");
      i += 1;
      if (templateDepth[templateDepth.length - 1] === 0) {
        templateDepth.pop();
        inTemplate = true;
      } else {
        templateDepth[templateDepth.length - 1] -= 1;
      }
    } else {
      put(ch, "code");
      i += 1;
    }
  }
  return { code: code.join(""), comments: comments.join(""), strings: strings.join("") };
}

/** По уже размеченному коду: начинает ли `/` в текущей позиции регулярное выражение. */
function regexAllowed(code) {
  let j = code.length - 1;
  while (j >= 0 && /\s/.test(code[j])) j -= 1;
  if (j < 0) return true;
  const prev = code[j];
  if (REGEX_AFTER_CHAR.has(prev)) return true;
  if (!/[\w$]/.test(prev)) return false;
  let start = j;
  while (start > 0 && /[\w$]/.test(code[start - 1])) start -= 1;
  return REGEX_AFTER_WORD.has(code.slice(start, j + 1).join(""));
}

/** Пропускает тело регулярного выражения; косые черты остаются в коде, флаги разбираются как код. */
function skipRegex(text, start, put) {
  put("/", "code");
  let i = start + 1;
  let inClass = false;
  while (i < text.length && text[i] !== "\n") {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) {
      put(ch, "none");
      put(text[i + 1], "none");
      i += 2;
      continue;
    }
    if (ch === "/" && !inClass) {
      put(ch, "code");
      return i + 1;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    put(ch, "none");
    i += 1;
  }
  return i;
}

/**
 * Код вместе с текстом строк — всё, кроме комментариев (позиции те же).
 * @param {{ code: string, strings: string }} parts
 * @returns {string}
 */
export function withoutComments({ code, strings }) {
  let text = "";
  for (let i = 0; i < code.length; i += 1) text += code[i] === " " ? strings[i] : code[i];
  return text;
}

/**
 * Все совпадения регулярного выражения (флаг g) построчно.
 * @param {string} text
 * @param {RegExp} pattern
 * @returns {{ line: number, match: string, lineText: string }[]}
 */
export function findAll(text, pattern) {
  const found = [];
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  text.split("\n").forEach((lineText, index) => {
    regex.lastIndex = 0;
    for (const match of lineText.matchAll(regex)) {
      found.push({ line: index + 1, match: match[0], lineText });
    }
  });
  return found;
}

/**
 * Файлы с нужными расширениями в существующих корнях baseDir (пути относительные, через `/`, по алфавиту).
 * Не обходит SKIP_DIRS и фикстуры tooling (FIXTURES_DIR из rules.ts — общее исключение всех проверок).
 * @param {string} baseDir
 * @param {readonly string[]} roots
 * @param {{ extensions: readonly string[], skip?: (path: string) => boolean }} options
 * @returns {{ roots: string[], files: string[] }}
 */
export function listFiles(baseDir, roots, { extensions, skip = () => false }) {
  const existing = roots.filter((root) => existsSync(join(baseDir, root)));
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(baseDir, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && path !== FIXTURES_DIR) walk(path);
      } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(`.${ext}`))) {
        if (!skip(path)) files.push(path);
      }
    }
  };
  for (const root of existing) walk(root);
  return { roots: existing, files: files.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)) };
}

/**
 * Итог проверки по общим правилам: корень есть, а файлов в нём 0 — код 2 («молчаливый ноль», ARCHITECTURE §15:
 * проверка, скорее всего, пуста из-за исключений); есть нарушения — код 1; иначе 0. Корня нет вовсе — это
 * чистый результат: код ещё не написан.
 * Нарушения упорядочиваются по файлу, затем по строке: проверке не нужно сортировать их самой.
 * @param {{ roots: string[], files: string[], findings: Finding[] }} input
 * @returns {CheckResult}
 */
export function checkResult({ roots, files, findings: found }) {
  const findings = found.toSorted((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );
  const empty = roots.filter((root) => !files.some((file) => file.startsWith(`${root}/`)));
  const messages = findings.map((f) => `${f.file}:${f.line} — ${f.message}`);
  if (empty.length > 0) {
    return {
      code: 2,
      files: files.length,
      findings,
      messages: [
        ...messages,
        `Корни есть, а проверяемых файлов в них 0: ${empty.join(", ")}.\n` +
          "  Проверка, скорее всего, пуста: исключения съели все файлы или расширения не те.",
      ],
    };
  }
  return { code: findings.length > 0 ? 1 : 0, files: files.length, findings, messages };
}

/**
 * Печать итога для make: нарушения — в stderr, сводка «проверено файлов: N» — в stdout.
 * @param {string} name
 * @param {CheckResult} result
 * @returns {0 | 1 | 2}
 */
export function report(name, result) {
  for (const message of result.messages) console.error(`✖ ${message}`);
  const status =
    result.code === 0
      ? "нарушений нет"
      : result.code === 1
        ? `нарушений: ${result.findings.length}`
        : "не смог проверить";
  console.log(`${name}: проверено файлов: ${result.files}, ${status}.`);
  return result.code;
}

/**
 * @typedef {{ file: string, line: number, rule: string, message: string }} Finding
 * @typedef {{ code: 0 | 1 | 2, files: number, findings: Finding[], messages: string[] }} CheckResult
 */
