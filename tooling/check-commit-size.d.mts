// Типы для check-commit-size.mjs: скрипт запускается Node без сборки, тесты импортируют его из TypeScript.
export interface NumstatEntry {
  path: string;
  added: number;
  deleted: number;
  binary: boolean;
}

export interface CommitSizeResult {
  files: number;
  lines: number;
  errors: string[];
  warnings: string[];
}

export declare const LIMITS: {
  readonly warnFiles: number;
  readonly maxFiles: number;
  readonly warnLines: number;
  readonly maxLines: number;
  readonly minLines: number;
};

export declare function parseNumstat(raw: string): NumstatEntry[];
export declare function readTrailers(message: string): Map<string, string>;
export declare function checkCommitSize(input: {
  message: string;
  numstat: string;
}): CommitSizeResult;
