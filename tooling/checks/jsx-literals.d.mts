// Типы для jsx-literals.mjs: скрипт запускается Node без сборки, тесты импортируют его из TypeScript.
import type { CheckResult } from "./source-text.mjs";

export declare const ROOTS: string[];
export declare const TEXT_ATTRIBUTES: string[];
export declare function runJsxLiterals(options: { baseDir: string; oxlint?: string }): CheckResult;
