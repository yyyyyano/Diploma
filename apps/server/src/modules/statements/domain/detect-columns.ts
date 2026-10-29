// Колонки по словарю заголовков (STMT-04 шаг 2, эвристика без модели): роли из шапки, поправки по смыслу набора
// колонок, форматы дат и сумм — по образцам из данных. Не получилось (слов не знаем, нет даты или суммы) — undefined:
// тогда колонки определяет модель по небольшому фрагменту.
import { extractRows, inferFormats, type Extracted } from "./extract-rows.ts";
import type { Grid, HeaderLocation } from "./structure.ts";
import type { ColumnSchema, Role } from "./types.ts";
import { parseAmount, parseDate } from "./values.ts";

const MONEY: readonly Role[] = ["amount", "debit", "credit", "operationAmount"];

/** Нужные для разбора роли: дата и хотя бы одна колонка суммы. */
export function hasRequiredRoles(roles: readonly Role[]): boolean {
  return roles.includes("date") && roles.some((role) => MONEY.includes(role));
}

/** Роль повторяется («Остаток» дважды, две «Суммы»): остаётся первая, остальные не нужны. */
function dedupe(roles: readonly Role[]): Role[] {
  const seen = new Set<Role>();
  return roles.map((role) => {
    if (role === "ignore" || !seen.has(role)) {
      seen.add(role);
      return role;
    }
    return "ignore";
  });
}

/** Колонка без заголовка из словаря, в которой чаще всего слова — вероятное описание операции. */
function guessDescription(
  grid: Grid,
  dataStart: number,
  roles: readonly Role[],
): number | undefined {
  let best: { index: number; score: number } | undefined;
  for (const [index, role] of roles.entries()) {
    if (role !== "ignore") continue;
    let score = 0;
    for (const line of grid.lines.slice(dataStart, dataStart + 100)) {
      const text = line.cells[index] ?? "";
      const wordy =
        text.length > 2 &&
        parseAmount(text, ",") === undefined &&
        parseDate(text, "dmy") === undefined;
      if (wordy) score += text.length;
    }
    if (score > 0 && (best === undefined || score > best.score)) best = { index, score };
  }
  return best?.index;
}

export function schemaFromHeader(grid: Grid, header: HeaderLocation): ColumnSchema | undefined {
  if (header.roles === undefined) return undefined;
  let roles = dedupe(header.roles);
  // Рядом с «Суммой операции» простая «Валюта» — валюта операции, а не счёта.
  if (roles.includes("operationAmount") && roles.includes("amount")) {
    roles = roles.map((role) => (role === "currency" ? "operationCurrency" : role));
  }
  if (!hasRequiredRoles(roles)) return undefined;
  if (!roles.includes("description")) {
    const guess = guessDescription(grid, header.dataStart, roles);
    if (guess !== undefined)
      roles = roles.map((role, index) => (index === guess ? "description" : role));
  }
  return inferFormats(
    grid,
    header.dataStart,
    roles.map((role, index) => ({ index, role })),
  );
}

/** Схема годится, если разобрано ≥ 90 % строк с датой (и хотя бы одна): иначе формат не тот или изменился. */
export function isUsable(extracted: Extracted): boolean {
  return extracted.candidates > 0 && extracted.rows.length >= extracted.candidates * 0.9;
}

/** Проверка схемы на данных таблицы. */
export function checkSchema(
  grid: Grid,
  header: HeaderLocation,
  schema: ColumnSchema,
  currency: string,
): Extracted {
  return extractRows(grid, header.dataStart, schema, currency);
}
