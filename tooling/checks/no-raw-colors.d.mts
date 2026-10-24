// Типы для no-raw-colors.mjs: скрипт запускается Node без сборки, тесты импортируют его из TypeScript.
import type { CheckResult } from "./source-text.mjs";

export declare const ROOTS: string[];
export declare const THEME_DIR: string;
export declare function runNoRawColors(options: { baseDir: string }): CheckResult;
