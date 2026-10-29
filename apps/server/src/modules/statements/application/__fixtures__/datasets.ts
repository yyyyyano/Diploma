// Случаи синтетического набора datasets/statements для тестов: файл, его тип и эталон expected.json (T-025, QA-01).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Expected } from "../../../../../../../tooling/synth/statements/cases.ts";
import type { FileType } from "../../domain/types.ts";

const ROOT = fileURLToPath(new URL("../../../../../../../datasets/statements/", import.meta.url));

export type { Expected };

export interface DatasetCase {
  readonly id: string;
  readonly type: FileType;
  readonly bytes: Uint8Array;
  readonly expected: Expected;
}

export function caseIds(): string[] {
  return readdirSync(ROOT)
    .filter((name) => !name.endsWith(".md"))
    .toSorted((a, b) => a.localeCompare(b));
}

export function loadCase(id: string): DatasetCase {
  const file = readdirSync(join(ROOT, id)).find((name) => name.startsWith("statement."));
  if (file === undefined) throw new Error(`в случае ${id} нет файла выписки`);
  const ext = file.split(".")[1];
  const type: FileType =
    ext === "csv" || ext === "xlsx" || ext === "xls" || ext === "pdf" ? ext : "png";
  return {
    id,
    type,
    bytes: new Uint8Array(readFileSync(join(ROOT, id, file))),
    expected: JSON.parse(readFileSync(join(ROOT, id, "expected.json"), "utf8")) as Expected,
  };
}
