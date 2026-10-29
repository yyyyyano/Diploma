// XLSX и XLS (STMT-04 шаг 1): SheetJS CE из vendor/. Ячейки приводятся к тексту, который понимает общий разбор: строка —
// как есть; число — целое без дроби, иначе с двумя знаками и точкой (копейки); дата Excel — ISO «2026-09-15». Лист — тот,
// где больше всего непустых строк. XLSX до чтения проходит защиту от ZIP-бомб (zip-guard.ts).
import * as XLSX from "xlsx";
import { SandboxRejection } from "../../../../platform/sandbox/isolated.ts";
import type { RawLine, RawTable } from "../../domain/types.ts";
import { MAX_LINES } from "./read-csv.ts";
import { assertSafeZip } from "./zip-guard.ts";

const MAX_CELL = 2_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** Ячейка SheetJS → текст общего разбора. Даты SheetJS отдаёт как UTC-момент «стенных часов» ячейки. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const date = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
    const time = `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
    return time === "00:00" ? date : `${date}T${time}`;
  }
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return typeof value === "string" ? value.slice(0, MAX_CELL) : "";
}

export function readSheet(bytes: Uint8Array, kind: "xlsx" | "xls"): RawTable {
  if (kind === "xlsx") assertSafeZip(bytes);
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(bytes, { type: "array", cellDates: true, sheetRows: MAX_LINES + 1 });
  } catch {
    throw new SandboxRejection("unreadable");
  }
  let best: unknown[][] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (sheet === undefined) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    });
    if (rows.length > best.length) best = rows;
  }
  if (best.length > MAX_LINES) throw new SandboxRejection("too-big");
  const lines: RawLine[] = best.map((row) => ({
    cells: row.map((value) => ({ text: cellText(value) })),
  }));
  return { kind, lines };
}
