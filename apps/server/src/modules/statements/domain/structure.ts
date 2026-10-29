// Структура таблицы выписки (STMT-04 шаг 1–2): где шапка таблицы и как выровнять строки по колонкам. Шапку ищем по
// словарю заголовков, а если слов не знаем — по форме: последняя строка из одних слов перед первой строкой с датой.
// У PDF ячейки лежат без колонок (только координаты слов): по шапке строки выравниваются в колонки.
import { normalizeHeader, roleOfHeader } from "./column-roles.ts";
import type { RawLine, RawTable, Role, SourceKind } from "./types.ts";
import { parseDate } from "./values.ts";

/** Строка таблицы по колонкам: i-я ячейка — i-я колонка шапки. */
export interface GridLine {
  readonly cells: readonly string[];
  readonly page?: number;
  readonly y?: number;
}

export interface Grid {
  readonly kind: SourceKind;
  readonly lines: readonly GridLine[];
}

export interface HeaderLocation {
  /** Индекс строки шапки; −1 — шапки нет, таблица начинается с первой строки с датой. */
  readonly index: number;
  /** Индекс первой строки данных. */
  readonly dataStart: number;
  /** Тексты заголовков по колонкам (пусто, если шапки нет). */
  readonly texts: readonly string[];
  /** Смысл колонок по словарю; undefined — слов не знаем (определит модель). */
  readonly roles: readonly Role[] | undefined;
}

/** Сколько первых строк просматривается в поисках шапки: над таблицей бывает длинная шапка банка. */
const SCAN_LINES = 80;
const MONEY: readonly Role[] = ["amount", "debit", "credit", "operationAmount"];

const isDate = (text: string) =>
  parseDate(text, "dmy") !== undefined || parseDate(text, "mdy") !== undefined;
const isNumberLike = (text: string) => /^[\s \d.,()+\-−]+$/.test(text) && /\d/.test(text);
const filled = (line: RawLine) => line.cells.filter((cell) => cell.text.trim() !== "");

function hasDateCell(line: RawLine): boolean {
  return filled(line).some((cell) => isDate(cell.text.trim()));
}

/** Шапка по словарю: строка, где узнаны колонка даты и хотя бы одна колонка суммы. */
function byVocabulary(lines: readonly RawLine[]): HeaderLocation | undefined {
  for (const [index, line] of lines.slice(0, SCAN_LINES).entries()) {
    const roles = line.cells.map((cell) => roleOfHeader(cell.text));
    if (roles.includes("date") && roles.some((role) => MONEY.includes(role))) {
      return {
        index,
        dataStart: index + 1,
        texts: line.cells.map((cell) => cell.text.trim()),
        roles,
      };
    }
  }
  return undefined;
}

/** Шапка по форме: ≥ 3 слова без дат и чисел прямо перед первой строкой, где есть дата и ≥ 3 ячеек. */
function byShape(lines: readonly RawLine[]): HeaderLocation | undefined {
  const first = lines
    .slice(0, SCAN_LINES)
    .findIndex((line) => hasDateCell(line) && filled(line).length >= 3);
  if (first < 0) return undefined;
  const above = lines[first - 1];
  const cells = above === undefined ? [] : filled(above);
  if (
    above !== undefined &&
    cells.length >= 3 &&
    cells.every((cell) => !isDate(cell.text.trim()) && !isNumberLike(cell.text))
  ) {
    return {
      index: first - 1,
      dataStart: first,
      texts: above.cells.map((cell) => cell.text.trim()),
      roles: undefined,
    };
  }
  // Шапки нет: данные идут с первой строки с датой.
  return { index: -1, dataStart: first, texts: [], roles: undefined };
}

/** Где шапка таблицы; undefined — в таблице нет ни строки с датой, ни знакомой шапки. */
export function locateHeader(table: RawTable): HeaderLocation | undefined {
  return byVocabulary(table.lines) ?? byShape(table.lines);
}

/**
 * Строки по колонкам шапки. CSV и Excel — по номеру ячейки; PDF — по координатам: слово попадает в колонку, чей
 * заголовок ближе по левому или правому краю (числа выровнены вправо, слова — влево).
 */
export function toGrid(table: RawTable, header: HeaderLocation): Grid {
  if (table.kind !== "pdf") {
    return {
      kind: table.kind,
      lines: table.lines.map((line) => ({ cells: line.cells.map((cell) => cell.text.trim()) })),
    };
  }
  const head = header.index >= 0 ? table.lines[header.index] : undefined;
  const columns = (head?.cells ?? []).flatMap((cell) =>
    cell.x0 === undefined || cell.x1 === undefined ? [] : [{ x0: cell.x0, x1: cell.x1 }],
  );
  const lines = table.lines.map((line, i): GridLine => {
    const meta = {
      ...(line.page === undefined ? {} : { page: line.page }),
      ...(line.y === undefined ? {} : { y: line.y }),
    };
    if (columns.length === 0 || i <= header.index) {
      return { cells: line.cells.map((cell) => cell.text.trim()), ...meta };
    }
    const slots: string[] = columns.map(() => "");
    for (const cell of line.cells) {
      if (cell.x0 === undefined || cell.x1 === undefined || cell.text.trim() === "") continue;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const [j, column] of columns.entries()) {
        const distance = Math.min(Math.abs(cell.x0 - column.x0), Math.abs(cell.x1 - column.x1));
        if (distance < bestDistance) {
          best = j;
          bestDistance = distance;
        }
      }
      slots[best] = `${slots[best] === "" ? "" : `${slots[best]} `}${cell.text.trim()}`;
    }
    return { cells: slots, ...meta };
  });
  return { kind: "pdf", lines };
}

/** Строка из текста шапки для отпечатка формата: нормализованные заголовки колонок. */
export function headerSignature(kind: SourceKind, header: HeaderLocation, grid: Grid): string {
  if (header.index >= 0) return `${kind}|h|${header.texts.map(normalizeHeader).join("¦")}`;
  const first = grid.lines[header.dataStart];
  const shape = (first?.cells ?? []).map((text) =>
    text === "" ? "E" : isDate(text) ? "D" : isNumberLike(text) ? "N" : "T",
  );
  return `${kind}|n|${shape.join("")}`;
}
