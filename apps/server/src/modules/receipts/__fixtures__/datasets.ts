// Случаи синтетического набора datasets/receipts для тестов: фото, его тип и эталон expected.json (T-027, QA-01).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Expected } from "../../../../../../tooling/synth/receipts/cases.ts";
import type { PhotoType } from "../application/ports.ts";

const ROOT = fileURLToPath(new URL("../../../../../../datasets/receipts/", import.meta.url));

export type { Expected };

export interface ReceiptCase {
  readonly id: string;
  readonly type: PhotoType;
  readonly bytes: Uint8Array;
  readonly expected: Expected;
}

export function caseIds(): string[] {
  return readdirSync(ROOT)
    .filter((name) => !name.endsWith(".md"))
    .toSorted((a, b) => a.localeCompare(b));
}

export function loadCase(id: string): ReceiptCase {
  const file = readdirSync(join(ROOT, id)).find((name) => name.startsWith("receipt."));
  if (file === undefined) throw new Error(`в случае ${id} нет фото чека`);
  const ext = file.split(".")[1];
  const type: PhotoType = ext === "png" || ext === "heic" ? ext : "jpg";
  return {
    id,
    type,
    bytes: new Uint8Array(readFileSync(join(ROOT, id, file))),
    expected: JSON.parse(readFileSync(join(ROOT, id, "expected.json"), "utf8")) as Expected,
  };
}
