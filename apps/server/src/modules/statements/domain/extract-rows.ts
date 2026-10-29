// Операции по схеме колонок (STMT-04: операции разбирает программа, не модель): значения строки → ParsedRow. Знак —
// со стороны счёта: «Расход»/«Дебет» — минус, «Приход»/«Кредит» — плюс. Длинное описание в PDF переносится на вторую
// строку без даты и сумм — она дописывается к описанию предыдущей операции.
import { Money } from "@kosht/kernel";
import { detectDateOrder, detectDecimal, parseAmount, parseDate, parseTime } from "./values.ts";
import type { Grid, GridLine } from "./structure.ts";
import type { ColumnSchema, ColumnSpec, DateOrder, ParsedRow, Role } from "./types.ts";
import { MONEY_ROLES } from "./types.ts";

export interface Extracted {
  readonly rows: readonly ParsedRow[];
  /** Строки с датой, у которых не нашлась сумма: не операции или не разобрались — сайт предупредит. */
  readonly skipped: number;
  /** Строки с датой — кандидаты в операции: по доле разобранных проверяется схема. */
  readonly candidates: number;
}

const ISO_CURRENCY = /^[A-Z]{3}$/;

function specOf(schema: ColumnSchema, role: Role): ColumnSpec | undefined {
  return schema.columns.find((column) => column.role === role);
}

const cellOf = (line: GridLine, spec: ColumnSpec | undefined): string =>
  spec === undefined ? "" : (line.cells[spec.index] ?? "");

/** Порядок даты и разделители сумм по образцам таблицы: первые 200 строк данных хватает. */
export function inferFormats(
  grid: Grid,
  dataStart: number,
  columns: readonly { readonly index: number; readonly role: Role }[],
): ColumnSchema {
  const lines = grid.lines.slice(dataStart, dataStart + 200);
  const samples = (index: number) =>
    lines.map((line) => line.cells[index] ?? "").filter((text) => text !== "");
  const dateColumn = columns.find((column) => column.role === "date");
  const dateOrder: DateOrder =
    dateColumn === undefined ? "dmy" : detectDateOrder(samples(dateColumn.index));
  return {
    dateOrder,
    columns: columns.map((column) =>
      MONEY_ROLES.includes(column.role)
        ? { ...column, decimal: detectDecimal(samples(column.index)) ?? "," }
        : { index: column.index, role: column.role },
    ),
  };
}

/** Валюта выписки: из шапки, иначе самая частая в колонке валюты; нет ни там, ни там — undefined. */
export function pickCurrency(
  declared: string | undefined,
  grid: Grid,
  dataStart: number,
  schema: ColumnSchema,
): string | undefined {
  if (declared !== undefined) return declared;
  const spec = specOf(schema, "currency");
  if (spec === undefined) return undefined;
  const counts = new Map<string, number>();
  for (const line of grid.lines.slice(dataStart)) {
    const code = cellOf(line, spec).toUpperCase();
    if (ISO_CURRENCY.test(code)) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()].toSorted((a, b) => b[1] - a[1])[0]?.[0];
}

/** Шаг между строками одной страницы PDF: медиана расстояний между соседними строками с датой. */
function linePitch(grid: Grid, dateIndex: number | undefined, order: DateOrder): number {
  const gaps: number[] = [];
  let previous: GridLine | undefined;
  for (const line of grid.lines) {
    const isRow =
      dateIndex !== undefined && parseDate(line.cells[dateIndex] ?? "", order) !== undefined;
    if (!isRow) continue;
    if (previous?.page === line.page && previous?.y !== undefined && line.y !== undefined) {
      const gap = previous.y - line.y;
      if (gap > 0) gaps.push(gap);
    }
    previous = line;
  }
  const sorted = gaps.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 12;
}

/** Применить схему к строкам данных. `currency` — валюта выписки (счёта). */
export function extractRows(
  grid: Grid,
  dataStart: number,
  schema: ColumnSchema,
  currency: string,
): Extracted {
  const date = specOf(schema, "date");
  const time = specOf(schema, "time");
  const description = specOf(schema, "description");
  const amount = specOf(schema, "amount");
  const debit = specOf(schema, "debit");
  const credit = specOf(schema, "credit");
  const rowCurrency = specOf(schema, "currency");
  const operationAmount = specOf(schema, "operationAmount");
  const operationCurrency = specOf(schema, "operationCurrency");
  const balance = specOf(schema, "balance");
  const operationId = specOf(schema, "operationId");
  const rows: ParsedRow[] = [];
  let skipped = 0;
  let candidates = 0;
  if (date === undefined) return { rows, skipped, candidates };
  const pitch = linePitch(grid, date.index, schema.dateOrder);
  const descriptionIndex = description?.index;
  // Нераспознанные колонки с текстом — на случай, когда «Описание» в шапке не нашли.
  const free = schema.columns
    .filter((column) => column.role === "ignore")
    .map((column) => column.index);
  let last: { row: ParsedRow; page: number | undefined; y: number | undefined } | undefined;
  const parse = (line: GridLine, spec: ColumnSpec | undefined) =>
    spec === undefined ? undefined : parseAmount(cellOf(line, spec), spec.decimal ?? ",");

  for (const line of grid.lines.slice(dataStart)) {
    const when = parseDate(cellOf(line, date), schema.dateOrder);
    if (when === undefined) {
      // Перенос описания (PDF): ячейки только в колонке описания, строка сразу под предыдущей операцией.
      const text =
        description === undefined ? "" : cellOf(line, description).replace(/\s+/g, " ").trim();
      const onlyDescription = line.cells.every((cell, i) => cell === "" || i === descriptionIndex);
      if (
        last !== undefined &&
        text !== "" &&
        onlyDescription &&
        line.page === last.page &&
        line.y !== undefined &&
        last.y !== undefined &&
        last.y - line.y > 0 &&
        last.y - line.y <= pitch * 1.6
      ) {
        const merged = { ...last.row, description: `${last.row.description} ${text}`.trim() };
        rows[rows.length - 1] = merged;
        last = { row: merged, page: line.page, y: line.y };
      }
      continue;
    }
    candidates++;
    let minor: number | undefined;
    if (amount !== undefined) {
      minor = parse(line, amount);
    } else if (debit !== undefined || credit !== undefined) {
      const out = parse(line, debit);
      const into = parse(line, credit);
      if (out !== undefined || into !== undefined) minor = Math.abs(into ?? 0) - Math.abs(out ?? 0);
    } else {
      minor = parse(line, operationAmount);
    }
    if (minor === undefined) {
      skipped++;
      continue;
    }
    const opCode = cellOf(line, operationCurrency).toUpperCase();
    // Единственная сумма — «сумма операции»: её валюта — валюта строки.
    const own = amount === undefined && debit === undefined && credit === undefined ? opCode : "";
    const code = (cellOf(line, rowCurrency) || own).toUpperCase();
    const money = Money.of(minor, ISO_CURRENCY.test(code) ? code : currency);
    const clock = when.time ?? (time === undefined ? undefined : parseTime(cellOf(line, time)));
    const opMinor = amount === undefined ? undefined : parse(line, operationAmount);
    const original =
      opMinor !== undefined && ISO_CURRENCY.test(opCode) && opCode !== money.currency
        ? Money.of(opMinor, opCode)
        : undefined;
    const balanceMinor = parse(line, balance);
    const text =
      description === undefined
        ? free
            .map((index) => line.cells[index] ?? "")
            .filter((cell) => cell !== "")
            .join(" ")
        : cellOf(line, description);
    const id = cellOf(line, operationId);
    const row: ParsedRow = {
      date: when.date,
      ...(clock === undefined ? {} : { time: clock }),
      description: text.replace(/\s+/g, " ").trim(),
      amount: money,
      ...(original === undefined ? {} : { original }),
      ...(balanceMinor === undefined ? {} : { balance: Money.of(balanceMinor, currency) }),
      ...(id === "" ? {} : { operationId: id }),
    };
    rows.push(row);
    last = { row, page: line.page, y: line.y };
  }
  return { rows, skipped, candidates };
}
