// Типы для deps-guard.mjs: скрипт запускается Node без сборки, тесты импортируют его из TypeScript.
export declare const MIN_MODULES: number;

export interface DepsGuardResult {
  code: 0 | 1 | 2;
  files: number;
  messages: string[];
}

export declare function runDepsGuard(options: {
  baseDir: string;
  minModules: number;
  requiredModules?: readonly string[];
}): Promise<DepsGuardResult>;
