// Типы для calc-no-clock.mjs: скрипт запускается Node без сборки, тесты импортируют его из TypeScript.
import type { CheckResult } from "./source-text.mjs";

export declare const ROOTS: string[];
export declare function runCalcNoClock(options: { baseDir: string }): CheckResult;
