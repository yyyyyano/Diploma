// Типы для floor.mjs: скрипт запускается Node без сборки, тесты импортируют его из TypeScript.
import type { CheckResult } from "./source-text.mjs";

export declare const MIN_FILES: number;
export declare function runFloor(options: { baseDir: string; minFiles: number }): CheckResult;
