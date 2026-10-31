#!/usr/bin/env node
// make static-checks → isolation: статический замок 4 изоляции данных (ROLE-01, SEC-04, ADR-0006,
// ARCHITECTURE §6.2, §6.4). Ловит то, чего не видят импорты dependency-cruiser: использование.
//   node tooling/checks/isolation.mjs
// Код выхода: 0 — чисто; 1 — нарушение; 2 — корень есть, а проверяемых файлов 0 (проверка пуста).
// Проверка текстовая (source-text.mjs): строки и комментарии вычищены, дальше — регулярные выражения. Её пределы
// честно: псевдоним (`const d = s.db; d.execute(...)`) она не видит — такой запрос всё равно проходит аудитор SQL
// (замок 3), а `sql` вне infrastructure/db не собрать без импорта drizzle-orm (правило drizzle-and-pg-only-in-db).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_DB } from "../architecture/rules.ts";
import { checkResult, findAll, listFiles, report, splitSource } from "./source-text.mjs";

/** Корни обхода: весь сервер и общие пакеты. */
export const ROOTS = ["apps/server/src", "packages"];

const SERVER = "apps/server/src";

/**
 * Где рождается Scope (ARCHITECTURE §6.4). Уточняют T-004 (kernel, testing), T-059 (http), T-006 (jobs, tools),
 * T-009 (регистрация и первый запуск — один файл identity), T-017 (удаление пользователя администратором — один файл
 * identity), T-052 (вход Telegram). Системные события общей правовой базы (`legal-base.act-updated`, `act-repealed`, T-036)
 * публикуются от имени первого активного администратора фасадом `identity.publishSystemEvent(event, ids)`: scope строит `new-user-scope.ts`, ScopedDb из identity не выходит
 * (по образцу `identity.system-initialized`) — отдельного места рождения scope у `legal-base` нет и быть не должно. Тесты, `__fixtures__` и `packages/testing` не проверяются вовсе (TEST_CODE).
 */
export const SCOPE_ENTRIES = [
  `${SERVER}/platform/http/`, // сайт: сессия → makeScope → context.s
  `${SERVER}/platform/jobs/`, // конверт задачи → scope с перепроверкой пользователя
  `${SERVER}/platform/tools/`, // адаптер defineTool → ctx.s из scope запуска агента
  `${SERVER}/modules/telegram/infrastructure/`, // вход Telegram: chat_id → telegram_links → scope
  `${SERVER}/modules/identity/application/new-user-scope.ts`, // регистрация / первый запуск: id нового пользователя
  `${SERVER}/modules/identity/application/target-user-scope.ts`, // удаление пользователя администратором (T-017)
  "packages/kernel/", // определение makeScope и бренда Scope
];

/** Папка возможностей БД — общая для всех путей PLATFORM_DB (rules.ts): миграции, ScopedDb, unsafeRaw. */
export const PLATFORM_DB_DIR = commonDir(Object.values(PLATFORM_DB));

/** Тестовый код: проверке не подлежит (makeScope, unsafeRaw и сырой SQL в тестах разрешены). */
const TEST_CODE = /\.(test|spec)\.tsx?$|^packages\/testing\//;

/** SQL пишется только здесь (ARCHITECTURE §4.2, ADR-0006). */
const DB_CODE = new RegExp(`^${SERVER}/modules/[^/]+/infrastructure/db/`);

/** Входы, в которых не бывает «чьих данных»: схемы контракта, инструментов агента, нагрузки задач и событий. */
const INPUT_FILES = [
  /^packages\/contract\//,
  new RegExp(`^${SERVER}/modules/[^/]+/agent/`),
  new RegExp(`^${SERVER}/modules/[^/]+/events\\.ts$`),
];
const SWEEP = /\.sweep\.ts$/;
const OWNER_KEYS = /^(userId|householdId|ownerId)$/;

const RULES = [
  {
    rule: "scope-outside-entry",
    pattern: /\bmakeScope\b|\bas\s+Scope\b|(?:[=(,:?]|\breturn)\s*<Scope>/,
    applies: (file) => !SCOPE_ENTRIES.some((entry) => file.startsWith(entry)),
    message: (match) =>
      `Scope собирается только на входах (ARCHITECTURE §6.4), найдено «${match}»: ` +
      "примите s: ScopedDb первым аргументом и берите s.scope.",
  },
  {
    rule: "raw-sql-outside-db",
    pattern:
      /\bsql\s*\.\s*raw\b|\b\w*(?:db|Db|DB|tx|Tx|client|Client|pool|Pool)\s*\.\s*execute\s*\(|\.\s*execute\s*\(\s*sql\b/,
    applies: (file) => !DB_CODE.test(file) && !file.startsWith(PLATFORM_DB_DIR),
    message: (match) =>
      `сырой SQL вне infrastructure/db, найдено «${match}»: перенесите запрос в репозиторий ` +
      "модуля (infrastructure/db/*.repo.ts) с s.own(таблица) на каждую таблицу (ADR-0006).",
  },
  {
    rule: "db-client-bypass",
    pattern: /\$client\b|\bunsafeRaw\b/,
    applies: (file) => !file.startsWith(PLATFORM_DB_DIR),
    message: (match) =>
      `«${match}» идёт мимо ScopedDb и аудитора SQL — он только для platform/db (миграции) и тестов: ` +
      "работайте через s: ScopedDb.",
  },
  {
    rule: "relational-query",
    pattern: /\b\w*(?:db|Db|DB|tx|Tx)\s*\.\s*query\s*\./,
    applies: () => true,
    message: (match) =>
      `реляционные запросы Drizzle (db.query.*) запрещены (CONSTRAINTS «Архитектурные запреты»), ` +
      `найдено «${match}»: перепишите через s.db.select(…) с s.own(таблица).`,
  },
];

const OWNER_MESSAGE = (key) =>
  `«чьи данные» не берутся из входа (ROLE-01), найдено поле «${key}»: уберите его из схемы входа процедуры, ` +
  "инструмента, нагрузки задачи или события — владелец приходит в scope (ctx.s, s.scope).";

/**
 * Проверка изоляции по корням baseDir.
 * @param {{ baseDir: string }} options
 * @returns {import("./source-text.mjs").CheckResult}
 */
export function runIsolation({ baseDir }) {
  const { roots, files } = listFiles(baseDir, ROOTS, {
    extensions: ["ts", "tsx", "mts", "cts"],
    skip: (path) => TEST_CODE.test(path),
  });
  const findings = [];
  for (const file of files) {
    const text = readFileSync(join(baseDir, file), "utf8");
    const { code } = splitSource(text);
    for (const { rule, pattern, applies, message } of RULES) {
      if (!applies(file)) continue;
      for (const { line, match } of findAll(code, pattern)) {
        findings.push({ file, line, rule, message: message(match.trim()) });
      }
    }
    if (isInputFile(file, code)) {
      for (const { line, key } of ownerKeys(text, code)) {
        findings.push({ file, line, rule: "owner-in-input", message: OWNER_MESSAGE(key) });
      }
    }
  }
  return checkResult({ roots, files, findings });
}

/** Файл описывает вход: контракт, инструменты, события модуля или задача модуля (defineJob), но не sweep. */
function isInputFile(file, code) {
  if (SWEEP.test(file)) return false;
  if (INPUT_FILES.some((pattern) => pattern.test(file))) return true;
  return file.startsWith(`${SERVER}/modules/`) && /\bdefineJob\s*\(/.test(code);
}

/**
 * Ключи-владельцы как поле объекта или типа: `userId:`, `userId?:`, `{ userId }`, `"userId":`.
 * Строки вычищены из code, поэтому ключ в кавычках сверяется по исходному тексту на тех же позициях.
 */
function ownerKeys(text, code) {
  const result = [];
  const rawLines = text.split("\n");
  code.split("\n").forEach((codeLine, index) => {
    const raw = rawLines[index] ?? "";
    const keys = [
      ...[...codeLine.matchAll(/\b(\w+)\s*\??\s*:/g)].map((m) => m[1]),
      ...[...codeLine.matchAll(/[{,]\s*(\w+)\s*(?=[,}])/g)].map((m) => m[1]),
      ...[...codeLine.matchAll(/(["'])\s*\1\s*\??\s*:/g)].map((m) =>
        raw.slice(m.index + 1, m.index + m[0].indexOf(m[1], 1)),
      ),
    ];
    for (const key of keys) {
      if (OWNER_KEYS.test(key)) result.push({ line: index + 1, key });
    }
  });
  return result;
}

function commonDir(paths) {
  const dirs = new Set(paths.map((path) => path.slice(0, path.lastIndexOf("/") + 1)));
  if (dirs.size !== 1) {
    throw new Error(`Пути PLATFORM_DB (rules.ts) лежат в разных папках: ${[...dirs].join(", ")}`);
  }
  return [...dirs][0];
}

if (import.meta.main) {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  process.exitCode = report("isolation", runIsolation({ baseDir: repoRoot }));
}
