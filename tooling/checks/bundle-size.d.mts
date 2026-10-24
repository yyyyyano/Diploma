// Типы для bundle-size.mjs: скрипт запускается Node без сборки, тесты импортируют его из TypeScript.
export interface Budgets {
  firstLoad: number;
  routeChunk: number;
  chatChunk: number;
}

export interface BundleFinding {
  file: string;
  rule: string;
  message: string;
}

export interface BundleSizeResult {
  code: 0 | 1 | 2;
  files: number;
  firstLoad: number;
  findings: BundleFinding[];
  messages: string[];
}

export declare const BUDGETS: Budgets;
export declare function runBundleSize(options: {
  distDir: string;
  budgets?: Budgets;
}): BundleSizeResult;
