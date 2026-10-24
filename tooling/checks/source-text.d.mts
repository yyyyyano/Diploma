// Типы для source-text.mjs: скрипты проверок запускаются Node без сборки, тесты импортируют их из TypeScript.
export interface SourceParts {
  code: string;
  comments: string;
  strings: string;
}

export interface LineMatch {
  line: number;
  match: string;
  lineText: string;
}

export interface Finding {
  file: string;
  line: number;
  rule: string;
  message: string;
}

export interface CheckResult {
  code: 0 | 1 | 2;
  files: number;
  findings: Finding[];
  messages: string[];
}

export declare function splitSource(text: string): SourceParts;
export declare function findAll(text: string, pattern: RegExp): LineMatch[];
export declare function listFiles(
  baseDir: string,
  roots: readonly string[],
  options: { extensions: readonly string[]; skip?: (path: string) => boolean },
): { roots: string[]; files: string[] };
export declare function checkResult(input: {
  roots: string[];
  files: string[];
  findings: Finding[];
}): CheckResult;
export declare function report(name: string, result: CheckResult): 0 | 1 | 2;
