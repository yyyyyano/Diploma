// Типы для isolation.mjs: скрипт запускается Node без сборки, тесты импортируют его из TypeScript.
import type { CheckResult } from "./source-text.mjs";

export declare const ROOTS: string[];
export declare const SCOPE_ENTRIES: string[];
export declare const PLATFORM_DB_DIR: string;
export declare function runIsolation(options: { baseDir: string }): CheckResult;
