// Типы для coverage-baseline.mjs: скрипт запускается Node без сборки, тесты импортируют его из TypeScript.
export interface Totals {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

export interface CoverageResult {
  code: 0 | 1 | 2;
  current: Totals | undefined;
  messages: string[];
}

export declare const TOLERANCE_PP: number;
export declare const METRICS: readonly ["lines", "statements", "functions", "branches"];
export declare function runCoverageBaseline(options: {
  summaryFile: string;
  baselineFile: string;
  write?: boolean;
}): CoverageResult;
