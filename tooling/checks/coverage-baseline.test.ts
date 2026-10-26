// CONSTRAINTS «Пороги с проверкой», T-011: покрытие не падает больше чем на 0,5 п. п. от базы
// tooling/coverage-baseline.json. Отчёт и база — во временной папке: тест не зависит от последнего make test.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCoverageBaseline, TOLERANCE_PP } from "./coverage-baseline.mjs";

const BASE = { lines: 90, statements: 90, functions: 95, branches: 85 };

let dir: string;
let summaryFile: string;
let baselineFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kosht-coverage-"));
  summaryFile = join(dir, "coverage-summary.json");
  baselineFile = join(dir, "coverage-baseline.json");
  writeFileSync(baselineFile, JSON.stringify(BASE));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function summary(pct: Partial<typeof BASE>) {
  const totals = { ...BASE, ...pct };
  const total = Object.fromEntries(
    Object.entries(totals).map(([m, value]) => [m, { total: 100, covered: value, pct: value }]),
  );
  writeFileSync(summaryFile, JSON.stringify({ total, "packages/calc/src/a.ts": total }));
}

describe("coverage-baseline: падение покрытия больше 0,5 п. п. — красный make check", () => {
  it("допуск — 0,5 п. п.", () => {
    expect(TOLERANCE_PP).toBe(0.5);
  });

  it("покрытие на уровне базы и падение ровно на 0,5 п. п. — код 0", () => {
    summary({ lines: 89.5, branches: 85 });
    expect(runCoverageBaseline({ summaryFile, baselineFile })).toMatchObject({ code: 0 });
  });

  it("строки упали на 0,6 п. п. — код 1 и сообщение с метрикой и базой", () => {
    summary({ lines: 89.4 });
    const result = runCoverageBaseline({ summaryFile, baselineFile });
    expect(result.code).toBe(1);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toContain("lines: 89,4 %");
    expect(result.messages[0]).toContain("базы 90 %");
  });

  it("каждая метрика сверяется отдельно: упали ветви — код 1", () => {
    summary({ lines: 99, branches: 84 });
    const result = runCoverageBaseline({ summaryFile, baselineFile });
    expect(result.code).toBe(1);
    expect(result.messages[0]).toMatch(/^branches:/);
  });

  it("нет отчёта покрытия или базы — код 2 («не смог проверить»), а не зелёный", () => {
    expect(runCoverageBaseline({ summaryFile, baselineFile }).code).toBe(2);
    summary({});
    rmSync(baselineFile);
    expect(runCoverageBaseline({ summaryFile, baselineFile }).code).toBe(2);
  });

  it("отчёт без total.branches.pct — код 2", () => {
    writeFileSync(summaryFile, JSON.stringify({ total: { lines: { pct: 90 } } }));
    expect(runCoverageBaseline({ summaryFile, baselineFile }).code).toBe(2);
  });

  it("--write поднимает базу до текущего покрытия", () => {
    summary({ lines: 93.25 });
    expect(runCoverageBaseline({ summaryFile, baselineFile, write: true }).code).toBe(0);
    expect(JSON.parse(readFileSync(baselineFile, "utf8"))).toEqual({ ...BASE, lines: 93.25 });
  });

  it("--write не опускает базу: код 1, файл базы прежний", () => {
    summary({ functions: 94 });
    const result = runCoverageBaseline({ summaryFile, baselineFile, write: true });
    expect(result.code).toBe(1);
    expect(result.messages[0]).toContain("functions");
    expect(JSON.parse(readFileSync(baselineFile, "utf8"))).toEqual(BASE);
  });

  it("--write без базы — создаёт её", () => {
    rmSync(baselineFile);
    summary({});
    expect(runCoverageBaseline({ summaryFile, baselineFile, write: true }).code).toBe(0);
    expect(JSON.parse(readFileSync(baselineFile, "utf8"))).toEqual(BASE);
  });
});
