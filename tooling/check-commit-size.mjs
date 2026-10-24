#!/usr/bin/env node
// Размер коммита (ADR-0001, CONSTRAINTS.md «Коммиты»): ревью теряет внимание на больших коммитах, а
// крошечные дробят одну мысль. Две точки входа в одну чистую функцию checkCommitSize:
//   node tooling/check-commit-size.mjs <файл-сообщения>   — хук commit-msg, считает staged-изменения;
//   node tooling/check-commit-size.mjs --commit <ревизия>  — готовый коммит (make check-commits).
// Код выхода: 0 — можно, 1 — отказ, 2 — неверный запуск.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const LIMITS = { warnFiles: 20, maxFiles: 40, warnLines: 400, maxLines: 800, minLines: 3 };

// Не считаются: lock-файл, снимки миграций drizzle-kit, кассеты моделей — это генерируемые данные. Снимки — в
// обоих форматах drizzle-kit: meta/NNNN_snapshot.json (0.x) и <время>_<имя>/snapshot.json (1.0 RC).
const EXEMPT = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)drizzle\/(?:meta\/[^/]*|[^/]+\/)snapshot\.json$/,
  /(^|\/)__cassettes__\//,
];

// Одна строка — законная правка только для этих типов; остальным нужен трейлер Small-Commit.
const TINY_OK_TYPES = new Set(["docs", "chore", "style", "fix", "revert"]);

// Разбор `git diff --numstat -z` / `git show --numstat -z`. Переименование приходит как
// «добавлено<TAB>удалено<TAB><NUL>старый<NUL>новый<NUL>»; бинарный файл — с «-» вместо чисел.
export function parseNumstat(raw) {
  const tokens = raw.split("\0");
  const entries = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i].replace(/^\n+/, "");
    if (token === "") continue;
    const [added = "", deleted = "", path = ""] = token.split("\t");
    let target = path;
    if (target === "") {
      target = tokens[i + 2] ?? "";
      i += 2;
    }
    const binary = added === "-" || deleted === "-";
    entries.push({
      path: target,
      added: binary ? 0 : Number(added),
      deleted: binary ? 0 : Number(deleted),
      binary,
    });
  }
  return entries;
}

// Сообщение без строк-комментариев git и без диффа после «ножниц» (git commit -v).
function cleanMessage(message) {
  const lines = [];
  for (const line of message.split("\n")) {
    if (/^# -+ >8 -+$/.test(line)) break;
    if (!line.startsWith("#")) lines.push(line);
  }
  return lines.join("\n").trim();
}

// Трейлеры git — последний абзац сообщения (не заголовок), каждая строка которого «Ключ: значение»
// (строки с отступом — продолжение значения). Ключи — в нижнем регистре, как сравнивает git.
export function readTrailers(message) {
  const trailers = new Map();
  const paragraphs = cleanMessage(message).split(/\n[ \t]*\n/);
  if (paragraphs.length < 2) return trailers;
  const last = paragraphs.at(-1).split("\n");
  const parsed = [];
  for (const line of last) {
    const match = /^([A-Za-z0-9][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
    if (match) parsed.push([match[1].toLowerCase(), match[2]]);
    else if (/^[ \t]+\S/.test(line) && parsed.length > 0) parsed.at(-1)[1] += ` ${line.trim()}`;
    else return trailers;
  }
  for (const [key, value] of parsed) trailers.set(key, value.trim());
  return trailers;
}

function commitType(header) {
  if (header.startsWith('Revert "')) return "revert";
  return /^(\w+)(\([^)]*\))?!?:/.exec(header)?.[1] ?? "";
}

function plural(n, one, few, many) {
  const tens = n % 100;
  const units = n % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}

// Чистая проверка: сообщение коммита + numstat → число файлов и строк, отказы и предупреждения.
export function checkCommitSize({ message, numstat }) {
  const counted = parseNumstat(numstat).filter((e) => !EXEMPT.some((re) => re.test(e.path)));
  const files = counted.length;
  const lines = counted.reduce((sum, e) => sum + e.added + e.deleted, 0);
  const result = { files, lines, errors: [], warnings: [] };

  const header = cleanMessage(message).split("\n", 1)[0] ?? "";
  // Слияние git создаёт сам; его дифф — чужие, уже проверенные коммиты.
  if (header.startsWith("Merge ")) return result;

  const trailers = readTrailers(message);
  const hasReason = (key) => (trailers.get(key) ?? "") !== "";
  const size = `${files} ${plural(files, "файл", "файла", "файлов")}, ${lines} ${plural(lines, "строка", "строки", "строк")}`;

  if (files > LIMITS.maxFiles || lines > LIMITS.maxLines) {
    if (!hasReason("large-commit")) {
      result.errors.push(
        `Коммит слишком большой: ${size} (предел ${LIMITS.maxFiles} файлов / ${LIMITS.maxLines} строк).\n` +
          "  Разбейте его на законченные шаги (git add -p) или, если он неделим (генерация, миграция),\n" +
          "  добавьте в конец сообщения отдельным абзацем трейлер «Large-Commit: <причина>».",
      );
    }
  } else if (files > LIMITS.warnFiles || lines > LIMITS.warnLines) {
    result.warnings.push(
      `Коммит крупный: ${size} (предупреждение от ${LIMITS.warnFiles} файлов / ${LIMITS.warnLines} строк). Нельзя ли разбить?`,
    );
  }

  // Бинарный файл (картинка, шрифт) — содержательное изменение без строк: мелким такой коммит не считаем.
  const onlyText = counted.every((e) => !e.binary);
  const tinyOk = TINY_OK_TYPES.has(commitType(header)) || hasReason("small-commit");
  if (files > 0 && onlyText && lines < LIMITS.minLines && !tinyOk) {
    result.errors.push(
      `Коммит слишком мелкий: ${size} (минимум ${LIMITS.minLines}).\n` +
        "  Объедините его с соседним изменением той же мысли, используйте тип docs/chore/style/fix/revert\n" +
        "  или добавьте в конец сообщения отдельным абзацем трейлер «Small-Commit: <причина>».",
    );
  }
  return result;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function main(argv) {
  let message;
  let numstat;
  if (argv[0] === "--commit" && argv[1]) {
    message = git(["log", "-1", "--format=%B", argv[1]]);
    numstat = git(["show", "--numstat", "-M", "-z", "--format=", argv[1]]);
  } else if (argv.length === 1 && !argv[0].startsWith("-")) {
    message = readFileSync(argv[0], "utf8");
    numstat = git(["diff", "--cached", "--numstat", "-M", "-z"]);
  } else {
    console.error(
      "check-commit-size: запуск — node tooling/check-commit-size.mjs <файл-сообщения> | --commit <ревизия>",
    );
    return 2;
  }
  const result = checkCommitSize({ message, numstat });
  for (const warning of result.warnings) console.error("!", warning);
  for (const error of result.errors) console.error("\n✖", error, "\n");
  return result.errors.length > 0 ? 1 : 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
