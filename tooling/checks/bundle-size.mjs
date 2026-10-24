#!/usr/bin/env node
// Бюджет JS сайта (CONSTRAINTS «Бюджеты производительности»): первая загрузка ≤ 300 КБ gzip, чанк маршрута
// ≤ 150 КБ, чанк чата с Markdown ≤ 200 КБ. Входит в make check-full (цель добавит T-011), не в make check:
// нужна сборка сайта.
//   node tooling/checks/bundle-size.mjs [папка сборки, по умолчанию apps/web/dist]
// Код выхода: 0 — в бюджете; 1 — превышение; 2 — не смог проверить (нет сборки, нет скриптов в index.html,
// ссылка на несуществующий файл).
// Форма сборки — Vite: «первая загрузка» — <script src> и <link rel="modulepreload"> из index.html, остальные
// .js — ленивые чанки; чанк чата — имя с assistant или chat. gzip — zlib с уровнем по умолчанию; 1 КБ = 1000 байт,
// как в отчёте Vite. Допущение: сайта ещё нет (T-008), на настоящей сборке скрипт прогоняют T-008 или T-011.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** Бюджеты в байтах gzip — из CONSTRAINTS.md (**[калибр.]**: меняет только главная сессия). */
export const BUDGETS = { firstLoad: 300_000, routeChunk: 150_000, chatChunk: 200_000 };

const CHAT_CHUNK = /assistant|chat/i;
const INITIAL_SCRIPT =
  /<script\b[^>]*\bsrc="([^"]+)"[^>]*>|<link\b(?=[^>]*\brel="modulepreload")[^>]*\bhref="([^"]+)"[^>]*>/g;
const KB = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

/**
 * @param {{ distDir: string, budgets?: { firstLoad: number, routeChunk: number, chatChunk: number } }} options
 * @returns {BundleSizeResult}
 */
export function runBundleSize({ distDir, budgets = BUDGETS }) {
  const indexPath = join(distDir, "index.html");
  if (!existsSync(indexPath)) {
    return cannotCheck(`нет ${indexPath}: соберите сайт (Vite) и запустите проверку снова.`);
  }
  const initial = [...readFileSync(indexPath, "utf8").matchAll(INITIAL_SCRIPT)]
    .map((m) => m[1] ?? m[2] ?? "")
    .filter((src) => !/^[a-z]+:\/\//i.test(src))
    .map((src) => src.replace(/^\//, ""));
  if (initial.length === 0) {
    return cannotCheck(
      "в index.html нет ни одного <script src> и modulepreload — разбор формы сборки устарел, " +
        "а «0 КБ» не значит «в бюджете».",
    );
  }
  const missing = initial.filter((file) => !existsSync(join(distDir, file)));
  if (missing.length > 0) {
    return cannotCheck(`index.html ссылается на несуществующие файлы: ${missing.join(", ")}.`);
  }

  const size = (file) => gzipSync(readFileSync(join(distDir, file))).length;
  const scripts = listScripts(distDir);
  const firstLoad = initial.reduce((total, file) => total + size(file), 0);
  const findings = [];
  if (firstLoad > budgets.firstLoad) {
    findings.push({
      file: "index.html",
      rule: "first-load",
      message: over("первая загрузка (скрипты и modulepreload)", firstLoad, budgets.firstLoad),
    });
  }
  for (const file of scripts.filter((path) => !initial.includes(path))) {
    const isChat = CHAT_CHUNK.test(file.split("/").at(-1) ?? "");
    const budget = isChat ? budgets.chatChunk : budgets.routeChunk;
    const bytes = size(file);
    if (bytes > budget) {
      findings.push({
        file,
        rule: isChat ? "chat-chunk" : "route-chunk",
        message: over(isChat ? "чанк чата" : "чанк маршрута", bytes, budget),
      });
    }
  }
  return {
    code: findings.length > 0 ? 1 : 0,
    files: scripts.length,
    firstLoad,
    findings,
    messages: findings.map((f) => `${f.file} — ${f.message}`),
  };
}

function over(what, bytes, budget) {
  return (
    `${what}: ${KB.format(bytes / 1000)} КБ gzip — больше бюджета ${KB.format(budget / 1000)} КБ gzip ` +
    "(CONSTRAINTS): разделите код по маршрутам, загружайте тяжёлое лениво; поднимать бюджет нельзя."
  );
}

function cannotCheck(message) {
  return { code: 2, files: 0, firstLoad: 0, findings: [], messages: [message] };
}

/** Все .js сборки, пути относительно distDir через `/`, по алфавиту. */
function listScripts(distDir) {
  return readdirSync(distDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => relative(distDir, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * @typedef {{ file: string, rule: string, message: string }} BundleFinding
 * @typedef {{ code: 0 | 1 | 2, files: number, firstLoad: number, findings: BundleFinding[], messages: string[] }} BundleSizeResult
 */

if (import.meta.main) {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const distDir = process.argv[2] ?? join(repoRoot, "apps/web/dist");
  const result = runBundleSize({ distDir });
  for (const message of result.messages) console.error(`✖ ${message}`);
  if (result.code !== 2) {
    console.log(
      `bundle-size: скриптов: ${result.files}, первая загрузка ${KB.format(result.firstLoad / 1000)} КБ gzip ` +
        `из ${KB.format(BUDGETS.firstLoad / 1000)} КБ.`,
    );
  }
  process.exitCode = result.code;
}
