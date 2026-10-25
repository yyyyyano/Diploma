// Формула расчёта (P2, design/DESIGN.md §4 .formula): строки «название — значение», итог под чертой. Значения —
// готовые узлы (обычно <Money>) из трассы сервера: формула ничего не считает (P1).
import type { ReactNode } from "react";
import classes from "./Formula.module.css";

export interface FormulaRow {
  /** Ключ строки (ключ трассы): «fin.averageIncome». */
  readonly id: string;
  readonly label: ReactNode;
  readonly value: ReactNode;
}

export interface FormulaProps {
  readonly rows: readonly FormulaRow[];
  readonly total: FormulaRow;
}

export function Formula({ rows, total }: FormulaProps) {
  return (
    <dl className={classes.formula}>
      {rows.map((row) => (
        <div key={row.id} className={classes.row}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
      <div className={classes.total}>
        <dt>{total.label}</dt>
        <dd>{total.value}</dd>
      </div>
    </dl>
  );
}
