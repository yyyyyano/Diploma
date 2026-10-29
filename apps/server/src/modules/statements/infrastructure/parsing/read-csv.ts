// CSV (STMT-04 шаг 1): кодировка по содержимому и таблица через papaparse. Кодировка: BOM (utf-8, utf-16), иначе строгий
// utf-8 (`fatal: true`), а при ошибке — windows-1251: русские банки до сих пор отдают CSV в ней. Разделитель из
// «; , табуляция |» выбирает тот, при котором больше строк разбились на ≥ 3 колонки: шапка банка из одной ячейки
// не сбивает выбор.
import Papa from "papaparse";
import type { RawLine, RawTable } from "../../domain/types.ts";

/** Строк в таблице не больше: годовая выписка — тысячи, миллионы — это не выписка. */
export const MAX_LINES = 200_000;
const MAX_CELL = 2_000;

export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Не utf-8 — значит однобайтовая кодировка; для русских выписок это windows-1251.
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

const DELIMITERS = [";", "\t", ",", "|"] as const;

function pickDelimiter(text: string): string {
  let best: string = DELIMITERS[0];
  let bestScore = -1;
  for (const delimiter of DELIMITERS) {
    const sample = Papa.parse<string[]>(text, { delimiter, preview: 60, skipEmptyLines: "greedy" });
    const score = sample.data.filter((row) => row.length >= 3).length;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/** CSV → таблица; больше MAX_LINES строк — `null` (слишком большая выписка). */
export function readCsv(bytes: Uint8Array): RawTable | null {
  const text = decodeCsv(bytes);
  const parsed = Papa.parse<string[]>(text, {
    delimiter: pickDelimiter(text),
    skipEmptyLines: "greedy",
  });
  if (parsed.data.length > MAX_LINES) return null;
  const lines: RawLine[] = parsed.data.map((row) => ({
    cells: row.map((cell) => ({ text: cell.slice(0, MAX_CELL) })),
  }));
  return { kind: "csv", lines };
}
