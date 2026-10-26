#!/usr/bin/env node
// База покрытия (CONSTRAINTS «Пороги с проверкой», T-011): итог покрытия make test сверяется с
// tooling/coverage-baseline.json — падение любой метрики больше чем на 0,5 п. п. делает make check красным. Пороги
// по glob в vitest.config.ts — «пол» слоя, база — «не хуже, чем было»: новый код без тестов её опускает.
//   node tooling/checks/coverage-baseline.mjs            — сверить (входит в make test после vitest --coverage)
//   node tooling/checks/coverage-baseline.mjs --write    — записать текущее как базу (make coverage-baseline); базу
//                                                         можно только поднять — опустить её запись отказывается
// Код выхода: 0 — не хуже базы; 1 — падение или попытка опустить базу; 2 — не смог проверить (нет отчёта
// покрытия или базы, не та форма).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Допустимое падение в процентных пунктах: шум от перестановки строк, а не от нового кода без тестов. */
export const TOLERANCE_PP = 0.5;
export const METRICS = /** @type {const} */ (["lines", "statements", "functions", "branches"]);

/**
 * @param {{ summaryFile: string, baselineFile: string, write?: boolean }} options
 * @returns {CoverageResult}
 */
export function runCoverageBaseline({ summaryFile, baselineFile, write = false }) {
  const current = readTotals(
    summaryFile,
    "отчёт покрытия (json-summary Vitest) — запустите make test",
  );
  if (typeof current === "string") return cannotCheck(current);
  const baseline = existsSync(baselineFile) || !write ? readBaseline(baselineFile) : undefined;
  if (typeof baseline === "string") return cannotCheck(baseline);

  if (write) {
    const lowered = METRICS.filter((m) => baseline !== undefined && current[m] < baseline[m]);
    if (lowered.length > 0) {
      return {
        code: 1,
        current,
        messages: lowered.map(
          (m) =>
            `${m}: ${fmt(current[m])} % ниже базы ${fmt(baseline?.[m] ?? 0)} % — базу не опускают ` +
            "(CONSTRAINTS «Пол»): допишите тесты.",
        ),
      };
    }
    writeFileSync(baselineFile, `${JSON.stringify(current, null, 2)}\n`);
    return { code: 0, current, messages: [] };
  }

  if (baseline === undefined) return cannotCheck(`нет базы ${baselineFile}.`);
  const messages = METRICS.filter((m) => baseline[m] - current[m] > TOLERANCE_PP).map(
    (m) =>
      `${m}: ${fmt(current[m])} % — ниже базы ${fmt(baseline[m])} % больше чем на ${fmt(TOLERANCE_PP)} п. п. ` +
      "(tooling/coverage-baseline.json): допишите тесты нового кода.",
  );
  return { code: messages.length > 0 ? 1 : 0, current, messages };
}

function readTotals(file, what) {
  if (!existsSync(file)) return `нет файла ${file}: ${what}.`;
  const total = JSON.parse(readFileSync(file, "utf8"))?.total;
  const totals = {};
  for (const m of METRICS) {
    const pct = total?.[m]?.pct;
    if (typeof pct !== "number" || !Number.isFinite(pct)) return `${file}: нет total.${m}.pct.`;
    totals[m] = pct;
  }
  return totals;
}

function readBaseline(file) {
  if (!existsSync(file)) return `нет базы ${file}: запишите её make coverage-baseline.`;
  const json = JSON.parse(readFileSync(file, "utf8"));
  const totals = {};
  for (const m of METRICS) {
    if (typeof json?.[m] !== "number") return `${file}: нет числа ${m}.`;
    totals[m] = json[m];
  }
  return totals;
}

const fmt = (n) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

function cannotCheck(message) {
  return { code: 2, current: undefined, messages: [message] };
}

if (import.meta.main) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const write = process.argv.includes("--write");
  const result = runCoverageBaseline({
    summaryFile: `${root}coverage/coverage-summary.json`,
    baselineFile: `${root}tooling/coverage-baseline.json`,
    write,
  });
  for (const message of result.messages) console.error(`✖ ${message}`);
  if (result.code === 0 && result.current !== undefined) {
    const text = METRICS.map((m) => `${m} ${fmt(result.current[m])} %`).join(", ");
    console.log(`coverage-baseline: ${write ? "база записана" : "не хуже базы"} — ${text}.`);
  }
  process.exitCode = result.code;
}

/**
 * @typedef {{ lines: number, statements: number, functions: number, branches: number }} Totals
 * @typedef {{ code: 0 | 1 | 2, current: Totals | undefined, messages: string[] }} CoverageResult
 */
