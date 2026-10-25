#!/usr/bin/env node
// make deps-check: границы модулей (dependency-cruiser, правила — .dependency-cruiser.mjs из карты модулей)
// и страховка от «молчаливого нуля» (ADR-0002, ARCHITECTURE §15): dependency-cruiser с TypeScript 7 печатает
// «0 modules cruised, no violations» с кодом 0, и проверка границ становится пустой.
//   node tooling/checks/deps-guard.mjs
// Код выхода: 0 — чисто; 1 — нарушение правила или неразрешённый импорт; 2 — проверено меньше MIN_MODULES
// файлов или в графе нет modules/<id>/index.ts модуля карты (проверка, скорее всего, пуста или неполна).
import { cruise, format } from "dependency-cruiser";
import extractDepcruiseOptions from "dependency-cruiser/config-utl/extract-depcruise-options";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULES } from "../architecture/modules.ts";
import { ROOTS } from "../architecture/rules.ts";

/**
 * Сколько файлов репозитория должно попасть в обход: ~90 % файлов корней apps, packages, e2e, tooling (без
 * фикстур) на момент T-007 — 332 файла, все 36 модулей. Задачи, добавляющие код, поднимают его; опускать порог,
 * чтобы прошло, нельзя (CONSTRAINTS.md «Пол»).
 */
export const MIN_MODULES = 300;

/** index.ts модуля сервера: каждый модуль карты должен быть в графе (иначе его границы не проверены). */
const MODULE_INDEX = (id) => `apps/server/src/modules/${id}/index.ts`;

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const configPath = join(repoRoot, ".dependency-cruiser.mjs");

/**
 * Обход корней baseDir с правилами .dependency-cruiser.mjs.
 * Без кэша dependency-cruiser: его проверка совместимости не сверяет набор правил, и правка
 * .dependency-cruiser.mjs или обновление пакета отдали бы старый результат; выигрыш — доли секунды.
 * @param {{ baseDir: string, minModules: number, requiredModules?: readonly string[] }} options
 * @returns {Promise<{ code: 0 | 1 | 2, files: number, messages: string[] }>}
 */
export async function runDepsGuard({ baseDir, minModules, requiredModules = [] }) {
  const roots = ROOTS.filter((root) => existsSync(join(baseDir, root)));
  const options = await extractDepcruiseOptions(configPath);
  const cruiseOptions = { ...options, baseDir, validate: true };
  const result = roots.length === 0 ? null : (await cruise(roots, cruiseOptions)).output;

  const modules = result?.modules ?? [];
  const files = modules.filter((m) => roots.some((root) => m.source.startsWith(`${root}/`))).length;
  if (files < minModules) {
    return {
      code: 2,
      files,
      messages: [
        `Проверено файлов: ${files} — меньше порога ${minModules} (MIN_MODULES в tooling/checks/deps-guard.mjs).\n` +
          "  Проверка границ, скорее всего, пуста: dependency-cruiser не прочитал TypeScript (нужен typescript@6\n" +
          "  через packageExtensions, ADR-0002), корни обхода исключены или файлы удалены.",
      ],
    };
  }

  const sources = new Set(modules.map((m) => m.source));
  const absent = requiredModules.filter((id) => !sources.has(MODULE_INDEX(id)));
  if (absent.length > 0) {
    return {
      code: 2,
      files,
      messages: [
        `В графе нет ${absent.length} модулей карты (tooling/architecture/modules.ts):\n` +
          absent.map((id) => `  ${MODULE_INDEX(id)}`).join("\n") +
          "\n  Создайте модуль make new-module id=<id> или проверьте, что папка не исключена из обхода.",
      ],
    };
  }

  const messages = [];
  const unresolved = modules.flatMap((m) =>
    m.dependencies.filter((d) => d.couldNotResolve).map((d) => `${m.source} → ${d.module}`),
  );
  if (unresolved.length > 0) {
    messages.push(
      `Неразрешённые импорты (${unresolved.length}) — правила на таких рёбрах молчат:\n` +
        unresolved.map((line) => `  ${line}`).join("\n") +
        "\n  Исправьте путь, добавьте пакет в package.json или научите резолвер (enhancedResolveOptions).",
    );
  }
  const violations = result?.summary.violations ?? [];
  if (violations.length > 0) {
    const report = await format(result, { outputType: "err-long" });
    const text = typeof report.output === "string" ? report.output : JSON.stringify(report.output);
    messages.push(text.trim());
  }
  return { code: messages.length > 0 ? 1 : 0, files, messages };
}

async function main() {
  const started = performance.now();
  const { code, files, messages } = await runDepsGuard({
    baseDir: repoRoot,
    minModules: MIN_MODULES,
    requiredModules: MODULES.map((m) => m.id),
  });
  for (const message of messages) console.error(`\n✖ ${message}\n`);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (code === 0) {
    console.log(
      `deps-check: проверено файлов: ${files} (порог ${MIN_MODULES}), нарушений нет, ${seconds} с.`,
    );
  }
  return code;
}

if (import.meta.main) process.exitCode = await main();
