// Фрагмент таблицы для модели (STMT-04 шаг 2): только чтобы понять смысл колонок — шапка и несколько строк, каждая
// ячейка укорочена. Остальные строки модель не видит: операции разбирает программа (.claude/rules/llm.md). Облачной
// модели фрагмент уходит после маскирования личных данных (PRIV-03) — его делает шлюз llm.
import type { Grid, HeaderLocation } from "./structure.ts";

const MAX_CELL = 60;

const cut = (text: string) => (text.length > MAX_CELL ? `${text.slice(0, MAX_CELL)}…` : text);

/** Текст фрагмента: номера колонок с нуля, шапка (если есть) и первые строки данных. */
export function columnsFragment(grid: Grid, header: HeaderLocation, rows: number): string {
  const out = ["Колонки пронумерованы с нуля."];
  const head = header.index >= 0 ? grid.lines[header.index] : undefined;
  if (head !== undefined) {
    out.push(`Шапка: ${head.cells.map((cell, i) => `[${i}] ${cut(cell)}`).join(" | ")}`);
  }
  const data = grid.lines
    .slice(header.dataStart)
    .filter((line) => line.cells.some((cell) => cell !== ""))
    .slice(0, rows);
  for (const [i, line] of data.entries()) out.push(`${i + 1}: ${line.cells.map(cut).join(" | ")}`);
  return out.join("\n");
}
